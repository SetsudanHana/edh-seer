/** CR 603.4 intervening-if conditions the engine drops. FREE: Mongo reads only, no model.
 *
 *  A trigger's condition constrains the event INSTANCE, and nothing in the schema records one except
 *  `trigger.threshold`, which holds only the numeric `{atLeast}` subset. Everything else derives as a
 *  trigger wider than the card prints. The witness is Yuna, Grand Summoner — see `intervening-if.ts`.
 *
 *  Reports, per condition family: how many stored trigger clauses carry one, and how many of those
 *  have NOTHING in the derived doc representing it. `--fixture <path>` writes the unrepresented rows
 *  for `intervening-if-ratchet.test.ts`.
 *
 *    npx tsx --env-file=packages/tagger/.env packages/tagger/src/bin/intervening-if-audit.ts */
import { writeFileSync } from "node:fs";
import { connect, loadConfig } from "@mtg/data";
import { CLAUSES_COLLECTION, DERIVED_COLLECTION, type CardClausesDoc } from "../clause-store.js";
import { conditionFamily, interveningIfOf, type ConditionFamily } from "../derive/intervening-if.js";
import { normalizeTriggerVerb } from "../derive/derive.js";
import { segment } from "../segment.js";
import type { CardTags } from "../schema.js";

const fixtureAt = process.argv.indexOf("--fixture");
const store = await connect(loadConfig());
const clauses = store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION);
const derived = store.db.collection<CardTags>(DERIVED_COLLECTION);

interface Row { name: string; condition: string; family: ConditionFamily; event: string; text: string }
const carried: Row[] = [];
const unrepresented: Row[] = [];

for (const doc of await clauses.find({}).toArray()) {
  const card = await store.cards.findOne({ _id: doc.oracleId } as never) as unknown as
    { name: string; oracleText?: string; typeLine?: string; keywords?: unknown } | null;
  if (!card?.oracleText) continue;
  const kws = Array.isArray(card.keywords) ? card.keywords as string[] : [];
  const texts = new Map(segment(card.oracleText, kws, card.typeLine ?? "").map((c) => [c.id, c.text]));
  const tags = await derived.findOne({ oracleId: doc.oracleId });

  for (const clause of doc.canonical) {
    if (!clause.trigger?.event) continue;
    const text = texts.get(clause.id) ?? "";
    const condition = interveningIfOf(text);
    if (!condition) continue;
    const row: Row = {
      name: card.name, condition, family: conditionFamily(condition),
      event: clause.trigger.event, text: text.replace(/\n/g, " | "),
    };
    carried.push(row);
    // REPRESENTED means the derived doc says something about THIS clause's condition. Today the only
    // channel is `trigger.threshold`; if a slot lands later, add its check here and the count falls.
    // Matched on the trigger VERB rather than card-wide: an ability carries no clause id, and a card
    // whose OTHER trigger has a threshold says nothing about this one.
    const verb = normalizeTriggerVerb(clause.trigger.event);
    const represented = (tags?.abilities ?? []).some((a) =>
      a.trigger?.threshold !== undefined && (verb === null || a.trigger.verbs.includes(verb)));
    if (!represented) unrepresented.push(row);
  }
}

const byFamily = new Map<ConditionFamily, { carried: number; unrepresented: number }>();
for (const r of carried) {
  const e = byFamily.get(r.family) ?? { carried: 0, unrepresented: 0 };
  e.carried++;
  byFamily.set(r.family, e);
}
for (const r of unrepresented) byFamily.get(r.family)!.unrepresented++;

console.log(`clause corpus: ${await clauses.countDocuments({})} cards`);
console.log(`trigger clauses carrying an intervening if: ${carried.length} over ${new Set(carried.map((r) => r.name)).size} cards`);
console.log(`  of which NOTHING in the derived doc represents: ${unrepresented.length}\n`);
for (const [f, n] of [...byFamily].sort((a, b) => b[1].carried - a[1].carried)) {
  console.log(`  ${f.padEnd(18)} carried ${String(n.carried).padStart(4)}   unrepresented ${String(n.unrepresented).padStart(4)}`);
}
console.log("\nsample, by family:");
for (const [f] of byFamily) {
  for (const r of unrepresented.filter((x) => x.family === f).slice(0, 4)) {
    console.log(`  [${f}] ${r.name} — "${r.condition}"`);
    console.log(`      ${r.text.slice(0, 140)}`);
  }
}

// `--corpus`: the same predicate over EVERY card's printed text, clause docs or not. The clause
// corpus is 2,651 of ~34,000, so the count above understates the family by an order of magnitude —
// the mistake this repo has made twice, most recently reading `becomes-blocked` as 0 when the corpus
// holds 164.
if (process.argv.includes("--corpus")) {
  const wide = new Map<ConditionFamily, number>();
  const others = new Map<string, number>();
  let sentences = 0;
  const cards = new Set<string>();
  for await (const c of store.cards.find({}, { projection: { name: 1, oracleText: 1, typeLine: 1, keywords: 1 } })) {
    const card = c as unknown as { name: string; oracleText?: string; typeLine?: string; keywords?: unknown };
    if (!card.oracleText) continue;
    const kws = Array.isArray(card.keywords) ? card.keywords as string[] : [];
    for (const s of segment(card.oracleText, kws, card.typeLine ?? "")) {
      const cond = interveningIfOf(s.text);
      if (!cond) continue;
      sentences++;
      cards.add(card.name);
      const f = conditionFamily(cond);
      wide.set(f, (wide.get(f) ?? 0) + 1);
      if (f === "other") others.set(cond.toLowerCase(), (others.get(cond.toLowerCase()) ?? 0) + 1);
    }
  }
  console.log(`\nCORPUS-WIDE: ${sentences} trigger sentences over ${cards.size} cards`);
  for (const [f, n] of [...wide].sort((a, b) => b[1] - a[1])) console.log(`  ${f.padEnd(18)} ${String(n).padStart(5)}`);
  // WHAT IS IN `other` decides whether a slot is worth designing, so the audit prints it rather than
  // leaving the largest bucket unread — the house rule that caught the last three vocabulary calls.
  console.log(`\n  the ${others.size} distinct \`other\` conditions, most common first:`);
  for (const [c, n] of [...others].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`    ${String(n).padStart(4)}  ${c}`);
  }
}

if (fixtureAt !== -1) {
  const path = process.argv[fixtureAt + 1];
  const rows = unrepresented.map((r) => ({ name: r.name, condition: r.condition, family: r.family, text: r.text }))
    .sort((a, b) => `${a.name}${a.condition}`.localeCompare(`${b.name}${b.condition}`));
  writeFileSync(path, `${JSON.stringify(rows, null, 1)}\n`);
  console.log(`\nwrote ${rows.length} rows to ${path}`);
}
await store.close();
process.exit(0);
