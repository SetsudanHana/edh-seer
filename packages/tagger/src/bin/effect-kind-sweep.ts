/** THE OUTPUT SIDE, never swept. `EFFECT_KINDS` is a closed list of 30 payoff labels, and every
 *  sweep so far has looked at INPUTS — trigger events (TRIGGERS), actions (VERBS), subjects. Nothing
 *  has asked whether the 30 kinds cover what cards actually DO.
 *
 *  Two direct measurements, both free:
 *   1. `unclaimed` — actions `deriveAbilities` could not turn into an ability at all. An action with
 *      no effect kind is a fact the card states and the engine drops on the floor.
 *   2. the DISTRIBUTION of kinds actually used, so a kind nothing reaches is visible too — a label
 *      with zero corpus cards is either a gap in derivation or dead vocabulary.
 *
 *  Owner's framing 2026-08-15: this is research to make the corpus complete BEFORE money is spent on
 *  it, so an unclaimed action is exactly the thing worth finding now rather than after a 34k-card
 *  normalization. */
import { connect, loadConfig } from "@mtg/data";
import { CLAUSES_COLLECTION, DERIVED_COLLECTION, type CardClausesDoc } from "../clause-store.js";
import { deriveAbilities } from "../derive/derive.js";
import { EFFECT_KINDS } from "../schema.js";
import type { Ability } from "../schema.js";
import { segment } from "../segment.js";

const store = await connect(loadConfig());
const docs = await store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION).find({}).toArray();

const unclaimedVerbs = new Map<string, { n: number; eg: string[] }>();
let clausesSeen = 0;
for (const d of docs) {
  const card = await store.cards.findOne({ _id: d.oracleId } as never) as unknown as
    { name: string; oracleText?: string; keywords?: string[]; typeLine?: string } | null;
  const fresh = segment(card?.oracleText ?? "", card?.keywords ?? [], card?.typeLine ?? "");
  const texts: Record<number, string> = {};
  if (fresh.length === d.canonical.length) for (const c of fresh) texts[c.id] = c.text;
  clausesSeen += d.canonical.length;
  const out = deriveAbilities(d.canonical, card?.name, texts, undefined, card?.oracleText);
  for (const a of out.unclaimed) {
    const v = String(a.verb ?? "(none)");
    const e = unclaimedVerbs.get(v) ?? { n: 0, eg: [] };
    e.n++;
    if (e.eg.length < 3) e.eg.push(`${card?.name}: ${String(a.object ?? "").slice(0, 60)}`);
    unclaimedVerbs.set(v, e);
  }
}

console.log(`clauses examined: ${clausesSeen} over ${docs.length} cards\n`);
console.log(`=== 1. UNCLAIMED ACTIONS — stated by a card, turned into no ability ===`);
const total = [...unclaimedVerbs.values()].reduce((s, e) => s + e.n, 0);
console.log(`total ${total}\n`);
for (const [verb, e] of [...unclaimedVerbs].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${String(e.n).padStart(4)}  ${verb}`);
  for (const eg of e.eg) console.log(`          ${eg}`);
}

// --- 2. Which of the 30 kinds anything actually reaches.
const derived = await store.db.collection(DERIVED_COLLECTION).find({}).toArray() as unknown as
  { abilities?: Ability[] }[];
const used = new Map<string, number>();
for (const d of derived) for (const a of d.abilities ?? []) {
  const k = String(a.effect?.kind ?? "");
  if (k) used.set(k, (used.get(k) ?? 0) + 1);
}
console.log(`\n=== 2. EFFECT_KINDS coverage — ${used.size} of ${EFFECT_KINDS.length} reached ===`);
for (const [k, n] of [...used].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);
const dead = EFFECT_KINDS.filter((k) => !used.has(k));
console.log(`\n  NEVER PRODUCED (${dead.length}): ${dead.join(", ") || "(none)"}`);

await store.close();
process.exit(0);
