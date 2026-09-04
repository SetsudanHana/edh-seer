/** THE W1 INSTRUMENT: which partner rows carry a sentence that describes the wrong half of why the
 *  pair connects. Read-only -- Mongo and the BUILT artifact, no writes, free to re-run.
 *
 *  Two families, and the counts that closed W1 (2026-09-04, 88,768 verified rows before the work):
 *   - `verbMismatch`: the row's own event key and its sentence are about different channels.
 *     11,928 -> 0 across the pickReason and per-event-verification fixes.
 *   - `krenko`: right event, but the sentence names the card's synthesised BASELINE supply while an
 *     authored ability supplies the same demand -- the defect W1 was filed as. 5,541 -> 1,136,
 *     the residual audited by `w1-residual.ts` and found correct.
 *
 *  IT READS THE SENTENCE THE ARTIFACT STORED and matches it back to the reasons it was chosen from,
 *  rather than re-running the picker: an instrument that recomputes the decision measures the code's
 *  intent, not its output, and this one silently reported the pre-fix numbers after the fix until
 *  that was corrected. For the same reason it asks the engine with the option the BUILD uses.
 *
 *    set -a && source packages/tagger/.env && set +a
 *    npx tsx packages/matcher/src/bin/w1-blast.ts [--out static-out] */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig } from "@edh-seer/data";
import { DERIVED_COLLECTION, type CardTags } from "@edh-seer/tagger";
import { directedReasons } from "../edges.js";
import { loadHierarchy } from "../hierarchy.js";
import { demandForms, eventKey, supplyForms, type CardPageRecord } from "./partners-core.js";
import type { DeckCard } from "../types.js";

const outIdx = process.argv.indexOf("--out");
const outDir = outIdx >= 0 ? process.argv[outIdx + 1]! : "static-out";
const versionDir = readdirSync(outDir).find((d) => d.startsWith("v-"))!;
const partnersDir = join(outDir, versionDir, "partners");

const store = await connect(loadConfig());
const cards = await store.cards.find({}).toArray();
const derivedRows = await store.db.collection<CardTags>(DERIVED_COLLECTION).find({}).toArray();
const tagsByOracle = new Map(derivedRows.map((r) => [r.oracleId, r]));
const byName = new Map<string, DeckCard>();
for (const card of cards) {
  if (!byName.has(card.name)) byName.set(card.name, { card, tags: tagsByOracle.get(card._id) ?? null } as never);
}
const h = loadHierarchy();

/** Reason.tag is `verb:subject`; PartnerRow.event is `verb|type|subtype`. Compare the verb only,
 *  after the one rename zoneEventKey does. */
const tagVerb = (t: string): string => t.split(":")[0]!;
const rowVerb = (e: string): string => e.split("|")[0]!;
const tagMatchesRow = (tag: string, event: string): boolean => {
  const v = rowVerb(event);
  const accepted = v === "leaves" ? [v, "dies"] : v === "enters" ? [v, "enters-graveyard"] : [v];
  return accepted.includes(tagVerb(tag));
};

/** Does an authored ability emit satisfy this demand, and is every such emit a TOKEN entering? */
const authoredSupply = (d: DeckCard, demand: string) => {
  const accepted = new Set(demandForms(demand));
  const hits = (d.tags?.abilities ?? []).flatMap((a) => a.emits ?? [])
    .filter((e) => supplyForms(eventKey(e)).some((f) => accepted.has(f)));
  return { any: hits.length > 0, token: hits.length > 0 && hits.every((e) => e.subject?.token === true) };
};

let unmatched = 0;
const c = { rows: 0, verified: 0, implied: 0, verbMismatch: 0, krenko: 0, krenkoToken: 0, fixableByPick: 0 };
const affected = new Set<string>();
const affectedKrenko = new Set<string>();
const mismatchPairs = new Map<string, number>();
const examples: string[] = [];

for (const f of readdirSync(partnersDir)) {
  const shard: Record<string, CardPageRecord> = JSON.parse(readFileSync(join(partnersDir, f), "utf8"));
  for (const rec of Object.values(shard)) {
    const subject = byName.get(rec.name);
    if (!subject) continue;
    for (const row of rec.partners) {
      c.rows++;
      const partner = byName.get(row.name);
      if (!partner) continue;
      // THE SAME OPTION THE BUILD USES. Measuring with the default would judge rows the build never
      // produced, which is what an instrument that drifts from its subject does.
      const reasons = directedReasons(subject, partner, h, { tokensMediate: false });
      if (reasons.length === 0) continue;
      c.verified++;
      // THE SENTENCE THE ARTIFACT ACTUALLY STORED, matched back to the reasons it was chosen from --
      // never a re-run of the picker, which would measure the code's intent instead of its output.
      const same = reasons.filter((r) => r.text === row.reason);
      if (same.length === 0) { unmatched++; continue; }
      const chosen = same[0]!;
      const wantVerb = rowVerb(row.event);
      // FAMILY A: the sentence is about a different interaction than the row's own event key.
      if (!same.some((r) => tagMatchesRow(r.tag, row.event))) {
        c.verbMismatch++;
        affected.add(rec.name);
        const k = `${wantVerb} -> ${tagVerb(chosen.tag)}`;
        mismatchPairs.set(k, (mismatchPairs.get(k) ?? 0) + 1);
        continue;
      }
      // FAMILY B: right event, but the supply named is the card's baseline BODY.
      if (!same.every((r) => r.impliedProducer === true)) continue;
      c.implied++;
      affected.add(rec.name);
      const { any, token } = authoredSupply(subject, row.event);
      if (!any) continue;
      c.krenko++;
      if (token) c.krenkoToken++;
      affectedKrenko.add(rec.name);
      // Could pickReason have chosen an authored sentence for the same event instead?
      if (reasons.some((r) => tagMatchesRow(r.tag, row.event) && r.impliedProducer !== true)) c.fixableByPick++;
      else if (examples.length < 12) examples.push(`${rec.name} -> ${row.name} [${row.event}] ${token ? "TOKEN" : "nontoken"} n=${reasons.length} :: ${chosen.text}`);
    }
  }
}

console.log(JSON.stringify({ ...c, affectedCards: affected.size, krenkoCards: affectedKrenko.size, unmatched }, null, 2));
console.log("top verb mismatches:", [...mismatchPairs].sort((a, b) => b[1] - a[1]).slice(0, 10));
console.log(examples.join("\n"));
const krenko = byName.get("Krenko, Mob Boss")!;
const quest = byName.get("Quest for the Goblin Lord")!;
console.log("KRENKO:", JSON.stringify(directedReasons(krenko, quest, h).map((r) => ({ tag: r.tag, implied: r.impliedProducer, rep: r.repeatability, text: r.text })), null, 2));
await store.close?.();
