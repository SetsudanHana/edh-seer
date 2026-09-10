/** Does the shipped engine join THIS pair, in isolation? One line per reason.
 *
 *    npx tsx research/instruments/pair-probe.ts "Ashling, the Limitless -> Ingot Chewer" ["A -> B" ...]
 *
 *  Reads `cardTagsDerived` (the shipped source) the way `eval-pairs.ts` does, so a pair that prints
 *  nothing here is an engine silence and not a deck-context gate. Built 2026-09-10 to check the
 *  recall-v5 families one PR at a time; the isolation caveat is the compass's (roadmap Z4). */
import { connect, loadConfig, mongoLookup, normalizeName, docToCard } from "../../packages/data/src/index.js";
import type { CardTags } from "../../packages/tagger/src/index.js";
import { loadHierarchy, pairReasonsAcrossFaces } from "../../packages/matcher/src/index.js";
import type { DeckCard } from "../../packages/matcher/src/types.js";

const pairs = process.argv.slice(2).map((s) => s.split(/\s*->\s*/));
if (pairs.length === 0 || pairs.some((p) => p.length !== 2)) {
  console.error('usage: pair-probe.ts "Producer -> Consumer" [...]');
  process.exit(2);
}
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const derived = store.db.collection("cardTagsDerived");
const h = loadHierarchy();
async function resolve(name: string): Promise<DeckCard | null> {
  const doc = await lookup.findByName(normalizeName(name));
  if (!doc) return null;
  const tags = (await derived.findOne({ oracleId: doc._id })) as CardTags | null;
  return { card: docToCard(doc as never), tags };
}
for (const [an, bn] of pairs) {
  const a = await resolve(an!); const b = await resolve(bn!);
  if (!a || !b) { console.log(`?? ${an} -> ${bn}: ${!a ? an : bn} not in the corpus`); continue; }
  // `pairReasonsAcrossFaces` is the shipped path (every face of one against every face of the
  // other) and it is symmetric, so one call answers both directions.
  const rs = pairReasonsAcrossFaces(a, b, h);
  console.log(`${a.card.name} <-> ${b.card.name}: ${rs.length ? "" : "SILENT"}`);
  for (const r of rs) console.log(`    ${r.tag}  ${r.producer} -> ${r.consumer}  ${r.text}`);
}
await store.close();
