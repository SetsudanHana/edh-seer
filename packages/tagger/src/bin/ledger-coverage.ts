/** FREE. Reports resource-ledger coverage and checks the spec's witnesses against the corpus.
 *
 *  Read-only: opens the corpus, counts, prints. Nothing here writes. */
import { connect, loadConfig } from "@mtg/data";
import type { Ability } from "../schema.js";
import { segment } from "../segment.js";
import { tallyThresholds, type ThresholdTally } from "../derive/threshold.js";
import { CLAUSES_COLLECTION, DERIVED_COLLECTION, type CardClausesDoc } from "../clause-store.js";

const store = await connect(loadConfig());

const derived = await store.db.collection(DERIVED_COLLECTION).find({}).toArray();
console.log(`derived docs: ${derived.length}`);

let activated = 0, withCost = 0, total = 0, withAmount = 0, triggers = 0, withThreshold = 0;
for (const doc of derived) {
  for (const a of ((doc as Record<string, unknown>).abilities ?? []) as Ability[]) {
    total++;
    if (a.kind === "activated") { activated++; if (a.cost) withCost++; }
    if (a.amount !== undefined) withAmount++;
    if (a.trigger) { triggers++; if (a.trigger.threshold) withThreshold++; }
  }
}
console.log(`cost:      ${withCost} of ${activated} activated abilities non-empty`);
console.log(`amount:    ${withAmount} of ${total} abilities`);
console.log(`threshold: ${withThreshold} of ${triggers} triggers`);

// §8's breakdown: how many of the comparisons `thresholdFor` sees were refused by each exclusion,
// re-run over every clause carrying a trigger event -- the exact set derive.ts calls thresholdFor
// on (derive.ts:578). Recomputed from `segment()` rather than read back off the derived abilities,
// since a derived doc does not record which clause text produced which ability.
const clauseDocs = await store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION).find({}).toArray();
const tally: ThresholdTally = { excluded1: 0, excluded2: 0, excluded3: 0, accepted: 0 };
for (const doc of clauseDocs) {
  const card = await store.cards.findOne({ _id: doc.oracleId } as never);
  if (!card) continue;
  const texts: Record<number, string> = {};
  for (const c of segment(card.oracleText ?? "", card.keywords ?? [], card.typeLine ?? "")) texts[c.id] = c.text;
  for (const clause of doc.canonical) {
    if (!clause.trigger?.event) continue;
    const text = texts[clause.id];
    if (text) tallyThresholds(text, tally);
  }
}
console.log(
  `threshold breakdown: accepted ${tally.accepted} · excluded1(<=1) ${tally.excluded1} · ` +
  `excluded2(stat) ${tally.excluded2} · excluded3(rider) ${tally.excluded3}`,
);

// The spec's four witnesses. Join on cards._id === cardTagsDerived.oracleId -- the derived doc has
// NO name field, and joining on _id or name returns nothing while looking exactly like "this card
// has no derived tags".
const WITNESSES: [string, "threshold" | "none"][] = [
  ["The Millennium Calendar", "threshold"],
  ["Twenty-Toed Toad", "threshold"],
  ["Welcoming Vampire", "none"],
  ["Bolt Bend", "none"],
];
let failed = 0;
for (const [name, expected] of WITNESSES) {
  const card = await store.cards.findOne({ name } as never);
  if (!card) { console.log(`  ${name}: NOT IN CORPUS`); failed++; continue; }
  const doc = await store.db.collection(DERIVED_COLLECTION).findOne({ oracleId: card._id as unknown as string });
  const abilities = ((doc as Record<string, unknown> | null)?.abilities ?? []) as Ability[];
  const found = abilities.map((a) => a.trigger?.threshold?.atLeast).filter((n) => n !== undefined);
  const ok = expected === "threshold" ? found.length > 0 : found.length === 0;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: thresholds=${JSON.stringify(found)} (expected ${expected})`);
  if (!ok) failed++;
}
await store.close();
process.exit(failed > 0 ? 1 : 0);
