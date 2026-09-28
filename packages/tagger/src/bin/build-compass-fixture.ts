/** One-off: build the compass gold pairs' cards as a test fixture, so the derivation gate runs forever
 *  with no API credits and no database.
 *
 *  Usage: set -a && source .env && set +a && tsx src/bin/build-compass-fixture.ts [--from-store]
 *
 *  `--from-store` is FREE and the normal path: every gold card is rebuilt from what PRODUCTION derives
 *  from -- its stored CANONICAL clauses (`cardClauses.canonical`) and the card document through the
 *  same `derive-input.ts` helpers `derive-corpus` calls (owner 2026-09-28: the gate derived from a
 *  thinner input than production, so pairs passed live and failed offline). A card whose stored
 *  answer predates `NORMALIZE_MIN_COMPATIBLE` is refused, and a refusal writes nothing.
 *  Without the flag every card is re-normalized by the model, which SPENDS. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { connect, loadConfig } from "@edh-seer/data";
import { CLAUSES_COLLECTION, type CardClausesDoc } from "../clause-store.js";
import { charsFrom, clauseCosts, clauseFaces, clauseRequires, clauseTexts, grantedTokenClauses } from "../derive-input.js";
import { loadTaggerConfig } from "../config.js";
import { createProvider } from "../llm/factory.js";
import { normalizeCard } from "../normalize-card.js";
import { NORMALIZE_MIN_COMPATIBLE, NORMALIZE_VERSION } from "../normalize-prompt.js";

const GOLD = JSON.parse(readFileSync(
  new URL("../../../matcher/src/compass-pairs.json", import.meta.url), "utf8",
)) as { a: string; b: string; verified: boolean }[];

const OUT = new URL("../../../matcher/src/fixtures/compass-clauses.json", import.meta.url);
type CardDoc = Parameters<typeof charsFrom>[0] & { _id: string; allParts?: { component?: string; typeLine?: string }[] };

const fromStore = process.argv.includes("--from-store");
// THE ROLE EXPECTATIONS' CARDS TOO: `derive-roles.test.ts` checks owner role rulings on the same
// production-shaped derivation.
const ROLES = JSON.parse(readFileSync(
  new URL("../../../matcher/src/role-expectations.json", import.meta.url), "utf8",
)) as { card: string }[];
const names = [...new Set([...GOLD.filter((p) => p.verified).flatMap((p) => [p.a, p.b]), ...ROLES.map((r) => r.card)])].sort();
const store = await connect(loadConfig());
const provider = fromStore ? null : createProvider({ ...loadTaggerConfig(), maxTokens: 3000 });
const clausesCol = store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION);
const out: unknown[] = [];
const refusedCards: string[] = [];
const warnedCards: string[] = [];
console.log(fromStore ? `rebuilding ${names.length} card(s) from stored canonical clauses (no model call)` : `building fixture on ${provider!.model}, NORMALIZE_VERSION ${NORMALIZE_VERSION}`);

for (const name of names) {
  const doc = await store.db.collection("cards").findOne({ name }) as CardDoc | null;
  if (!doc) { console.log(`MISSING ${name}`); continue; }
  if (fromStore) {
    const stored = await clausesCol.findOne({ oracleId: doc._id });
    if (!stored?.canonical) { refusedCards.push(`${name}: no stored clauses`); continue; }
    if (stored.normalizeVersion < NORMALIZE_MIN_COMPATIBLE) { refusedCards.push(`${name}: stored at NORMALIZE ${stored.normalizeVersion} < ${NORMALIZE_MIN_COMPATIBLE}`); continue; }
    pushCard(name, doc, stored.canonical);
    continue;
  }
  // Gated, and retried once. The previous fixture shipped an INVENTED clause id for Mirkwood Bats
  // (the segmenter emits two clauses, the model answered three) because nothing here checked the
  // answer, and that fixture is what guards the derivation gate. A refusal is usually transient --
  // the observed one was a duplicate clause id -- so one retry, then give up on the card.
  let res = await normalizeCard(provider!, { ...doc, name });
  if (res.rejected.length) {
    process.stdout.write("r");
    res = await normalizeCard(provider!, { ...doc, name });
  }
  if (res.rejected.length) {
    refusedCards.push(`${name}: ${res.rejected.map((v) => `${v.kind} — ${v.detail}`).join(" | ")}`);
    continue;
  }
  if (res.violations.length) warnedCards.push(`${name}: ${res.violations.map((v) => v.kind).join(", ")}`);
  pushCard(name, doc, res.canonical);
}

/** Everything `derive-corpus` hands `deriveCardTags`, computed by the same helpers, so the offline gate
 *  derives exactly what production derives. `grantedToken` is a set in production, an array here. */
function pushCard(name: string, doc: CardDoc, clauses: unknown): void {
  out.push({
    name, oracleId: doc._id, clauses,
    characteristics: charsFrom({ ...doc, name }),
    clauseTexts: clauseTexts(doc), clauseCosts: clauseCosts(doc), clauseRequires: clauseRequires(doc),
    clauseFaces: clauseFaces(doc), grantedToken: [...grantedTokenClauses(doc)], oracleText: doc.oracleText ?? "",
    // THE PRINTED TYPE LINE, not a rebuild: the matcher parses it ("Creature — Human Cleric"), and the
    // test's `types subtypes` join has no dash, so Archpriest of Iona read as no Cleric at all.
    typeLine: doc.typeLine ?? "",
  });
  process.stdout.write(".");
}

// A partially-gated fixture is worse than no new fixture: it would mix vocabulary versions and
// silently weaken the very gate that guards the paid run. All or nothing.
if (refusedCards.length > 0) {
  console.log(`\n\nREFUSED ${refusedCards.length} card(s) -- NOT writing the fixture:`);
  for (const r of refusedCards) console.log(`  ${r}`);
  await store.close();
  process.exit(1);
}

mkdirSync(new URL(".", OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`\nwrote ${out.length} cards to ${OUT.pathname}`);
if (warnedCards.length) {
  console.log(`persisted with warnings (${warnedCards.length}):`);
  for (const w of warnedCards) console.log(`  ${w}`);
}
await store.close();
