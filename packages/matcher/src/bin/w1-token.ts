/** WHAT THE TOKEN-MEDIATION GATE COSTS A CARD PAGE, where no token node exists to carry the second
 *  hop it trades for. Read-only, Mongo and the built artifact.
 *
 *  MEASURED 2026-09-04, and it is what `ReasonOptions.tokensMediate` was built from: of 117,946
 *  sampled token-only candidate pairs, 61,890 returned no reason at all and **7,266 of those came
 *  back the moment the gate was off**. The other ~54,600 are the engine refusing on the merits,
 *  which is the two-phase design working.
 *
 *  THE COUNTERFACTUAL IS `isToken`, because that flag's only effect inside the event loop is the
 *  gate itself (edges.ts) -- a pair that appears once it is set was deleted by that gate alone. It
 *  predates the option and is kept because it proves the option's premise independently.
 *
 *  CEILING: 40 candidate pairs per card, so a card with thousands is under-counted. The figure is a
 *  floor on the loss, not an estimate of it. Upgrade path: drop the cap and wait longer.
 *
 *    set -a && source packages/tagger/.env && set +a
 *    npx tsx packages/matcher/src/bin/w1-token.ts */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig } from "@edh-seer/data";
import { DERIVED_COLLECTION, type CardTags } from "@edh-seer/tagger";
import { directedReasons } from "../edges.js";
import { loadHierarchy } from "../hierarchy.js";
import { demandForms, eventKey, supplyForms, type CardPageRecord } from "./partners-core.js";
import type { DeckCard } from "../types.js";

const outDir = "static-out";
const versionDir = readdirSync(outDir).find((d) => d.startsWith("v-"))!;
const partnersDir = join(outDir, versionDir, "partners");
const store = await connect(loadConfig());
const cards = await store.cards.find({}).toArray();
const derivedRows = await store.db.collection<CardTags>(DERIVED_COLLECTION).find({}).toArray();
const tagsByOracle = new Map(derivedRows.map((r) => [r.oracleId, r]));
const byName = new Map<string, DeckCard>();
for (const card of cards) if (!byName.has(card.name)) byName.set(card.name, { card, tags: tagsByOracle.get(card._id) ?? null } as never);
const h = loadHierarchy();

const tokenEmits = (d: DeckCard) => (d.tags?.abilities ?? []).flatMap((a) => a.emits ?? []).filter((e) => e.subject?.token === true);

let tokenMakers = 0, tokenMakersNoPartners = 0, others = 0, othersNoPartners = 0;
// For token makers, how many of their token-ranked candidate pairs the engine refuses outright.
let tokenPairs = 0, tokenPairsRefused = 0, tokenPairsGated = 0;
const refusedExamples: string[] = [];
const byDemand = new Map<string, DeckCard[]>();
const records: CardPageRecord[] = [];
for (const f of readdirSync(partnersDir)) {
  const shard: Record<string, CardPageRecord> = JSON.parse(readFileSync(join(partnersDir, f), "utf8"));
  for (const rec of Object.values(shard)) records.push(rec);
}
for (const rec of records) {
  const d = byName.get(rec.name);
  if (!d) continue;
  for (const k of new Set(rec.demands.flatMap(demandForms))) {
    const b = byDemand.get(k); if (b) b.push(d); else byDemand.set(k, [d]);
  }
}
for (const rec of records) {
  const d = byName.get(rec.name); if (!d) continue;
  const te = tokenEmits(d);
  if (te.length > 0) { tokenMakers++; if (rec.partners.length === 0) tokenMakersNoPartners++; }
  else { others++; if (rec.partners.length === 0) othersNoPartners++; }
  if (te.length === 0) continue;
  // Candidates reachable ONLY through a token emit: what the page would show if the token node existed.
  const nonTokenForms = new Set((d.tags?.abilities ?? []).flatMap((a) => a.emits ?? [])
    .filter((e) => e.subject?.token !== true).flatMap((e) => supplyForms(eventKey(e))));
  const tokenOnly = new Set(te.flatMap((e) => supplyForms(eventKey(e))).filter((f) => !nonTokenForms.has(f)));
  const cand = new Set<DeckCard>();
  for (const f of tokenOnly) for (const c of byDemand.get(f) ?? []) if (c.card.name !== d.card.name) cand.add(c);
  for (const c of [...cand].slice(0, 40)) {
    tokenPairs++;
    if (directedReasons(d, c, h).length === 0) {
      tokenPairsRefused++;
      // COUNTERFACTUAL: the only thing `isToken` changes in this loop is the token-mediation gate
      // (edges.ts:1014), so a pair that appears once the flag is set was deleted by that gate alone.
      if (directedReasons({ ...d, isToken: true } as never, c, h).length > 0) {
        tokenPairsGated++;
        if (refusedExamples.length < 10) refusedExamples.push(`${d.card.name} -> ${c.card.name}`);
      }
    }
  }
}
console.log(JSON.stringify({ tokenMakers, tokenMakersNoPartners, others, othersNoPartners, tokenPairs, tokenPairsRefused, tokenPairsGated }, null, 2));
console.log(refusedExamples.join("\n"));
await store.close?.();
