/** One-off: normalize the cards the compass gold pairs reference and commit the result as a test
 *  fixture, so the derivation gate runs forever with no API credits and no database.
 *
 *  Usage: TAGGER_PROVIDER=anthropic tsx src/bin/build-gold-fixture.ts */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { connect, loadConfig } from "@mtg/data";
import { loadTaggerConfig } from "../config.js";
import { createProvider } from "../llm/factory.js";
import { normalizeCard } from "../normalize-card.js";
import { NORMALIZE_VERSION } from "../normalize-prompt.js";
import type { Characteristics } from "../schema.js";

const GOLD = JSON.parse(readFileSync(
  new URL("../../../matcher/src/goldpairs.json", import.meta.url), "utf8",
)) as { a: string; b: string; verified: boolean }[];

const OUT = new URL("../../../matcher/src/fixtures/gold-clauses.json", import.meta.url);

const names = [...new Set(GOLD.filter((p) => p.verified).flatMap((p) => [p.a, p.b]))].sort();
const store = await connect(loadConfig());
const provider = createProvider({ ...loadTaggerConfig(), maxTokens: 3000 });
const out: unknown[] = [];
const refusedCards: string[] = [];
const warnedCards: string[] = [];
console.log(`building fixture on ${provider.model}, NORMALIZE_VERSION ${NORMALIZE_VERSION}`);

for (const name of names) {
  const doc = await store.db.collection("cards").findOne({ name }) as {
    _id: string; oracleText?: string; keywords?: string[]; typeLine?: string;
    colors?: string[]; colorIdentity?: string[]; manaValue?: number; power?: string | null;
    toughness?: string | null;
  } | null;
  if (!doc) { console.log(`MISSING ${name}`); continue; }

  // Gated, and retried once. The previous fixture shipped an INVENTED clause id for Mirkwood Bats
  // (the segmenter emits two clauses, the model answered three) because nothing here checked the
  // answer, and that fixture is what guards the derivation gate. A refusal is usually transient --
  // the observed one was a duplicate clause id -- so one retry, then give up on the card.
  let res = await normalizeCard(provider, { ...doc, name });
  if (res.rejected.length) {
    process.stdout.write("r");
    res = await normalizeCard(provider, { ...doc, name });
  }
  if (res.rejected.length) {
    refusedCards.push(`${name}: ${res.rejected.map((v) => `${v.kind} — ${v.detail}`).join(" | ")}`);
    continue;
  }
  if (res.violations.length) warnedCards.push(`${name}: ${res.violations.map((v) => v.kind).join(", ")}`);

  const [types, subtypes] = splitTypeLine(doc.typeLine ?? "");
  const characteristics: Characteristics = {
    types, subtypes,
    colors: doc.colors ?? [], identity: doc.colorIdentity ?? [],
    cmc: doc.manaValue ?? 0, power: doc.power ?? null, toughness: doc.toughness ?? null,
    token: false, keywords: doc.keywords ?? [],
  };
  out.push({ name, oracleId: doc._id, clauses: res.canonical, characteristics });
  process.stdout.write(".");
}

// A partially-gated fixture is worse than no new fixture: it would mix vocabulary versions and
// silently weaken the very gate that guards the paid run. All or nothing.
if (refusedCards.length > 0) {
  console.log(`\n\nREFUSED ${refusedCards.length} card(s) twice — NOT writing the fixture:`);
  for (const r of refusedCards) console.log(`  ${r}`);
  await store.close();
  process.exit(1);
}

/** "Legendary Creature — Human Warrior" -> [["legendary","creature"], ["human","warrior"]] */
function splitTypeLine(line: string): [string[], string[]] {
  const [left, right] = line.toLowerCase().split("—");
  return [
    (left ?? "").trim().split(/\s+/).filter(Boolean),
    (right ?? "").trim().split(/\s+/).filter(Boolean),
  ];
}

mkdirSync(new URL(".", OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`\nwrote ${out.length} cards to ${OUT.pathname}`);
if (warnedCards.length) {
  console.log(`persisted with warnings (${warnedCards.length}):`);
  for (const w of warnedCards) console.log(`  ${w}`);
}
await store.close();
