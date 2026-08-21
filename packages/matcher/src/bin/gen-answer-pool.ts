/** How many answers of each class EXIST inside a colour identity, corpus-wide.
 *  Free: Mongo read only, and the answer rules read oracle text + type line only (no tags). */
import { connect, docToCard, loadConfig } from "@mtg/data";
import { answerClassesOf } from "../rules.js";
const store = await connect(loadConfig());
const cards = store.db.collection("cards");

const CLASSES = ["creature", "artifact", "enchantment", "planeswalker", "land", "graveyard"] as const;
const COLORS = ["W", "U", "B", "R", "G"] as const;
const mask = (ci: string[]): number =>
  ci.reduce((m, c) => m | (1 << COLORS.indexOf(c as typeof COLORS[number])), 0);

// per card: its identity mask + which classes it answers
const rows: { m: number; cls: Set<string> }[] = [];
let n = 0;
const cursor = cards.find({}, { projection: { name: 1, oracleText: 1, typeLine: 1, colorIdentity: 1, keywords: 1, colors: 1, manaValue: 1, power: 1, toughness: 1, layout: 1, types: 1, subtypes: 1, supertypes: 1, faces: 1, allParts: 1, producedMana: 1 } });
for await (const doc of cursor) {
  n++;
  const dc = { card: docToCard(doc as never), tags: null };
  const cls = answerClassesOf(dc);
  if (cls.size === 0) continue;
  rows.push({ m: mask((doc as { colorIdentity?: string[] }).colorIdentity ?? []), cls: new Set(cls.keys()) });
}

const name = (m: number): string =>
  m === 0 ? "C" : COLORS.filter((_, i) => m & (1 << i)).join("");

console.log(`corpus ${n} cards, ${rows.length} carry an answer class\n`);
const header = ["identity", ...CLASSES].join("\t");
console.log(header);
for (let m = 0; m < 32; m++) {
  // a deck of identity m may play any card whose identity is a SUBSET of m
  const legal = rows.filter((r) => (r.m & ~m) === 0);
  if (m !== 0 && legal.length === 0) continue;
  const counts = CLASSES.map((c) => legal.filter((r) => r.cls.has(c)).length);
  console.log([name(m), ...counts].join("\t"));
}
await store.close();
