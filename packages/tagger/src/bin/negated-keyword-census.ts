/** How many corpus subjects narrow by the ABSENCE of a keyword — "creature you control without
 *  flying" — and how many of them sit in the derived corpus as real consumers. `SubjectFilter.keyword`
 *  (2026-08-14) is anchored on a preceding "with" and has no negated form, so these subjects derive
 *  WIDER than printed. Free, read-only. */
import { connect, loadConfig } from "@mtg/data";
import { KEYWORD_ABILITIES } from "../derive/subtypes.js";
import { DERIVED_COLLECTION } from "../clause-store.js";
import type { Ability } from "../schema.js";

const store = await connect(loadConfig());

const ALT = [...KEYWORD_ABILITIES].sort((a, b) => b.length - a.length)
  .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
// The two printed spellings. "non-flying" is the older template, "without flying" the current one.
const WITHOUT = new RegExp(`\\bwithout (${ALT})\\b`, "gi");
const NON = new RegExp(`\\bnon-(${ALT})\\b`, "gi");

const cards = await store.cards.find({ oracleText: /without |non-/i } as never).toArray() as unknown as
  { _id: string; name: string; oracleText?: string }[];

const derivedIds = new Set((await store.db.collection(DERIVED_COLLECTION).find({}).project({ oracleId: 1 }).toArray())
  .map((d) => (d as unknown as { oracleId: string }).oracleId));

interface Hit { name: string; keyword: string; spelling: string; sentence: string; derived: boolean }
const hits: Hit[] = [];
for (const c of cards) {
  const text = c.oracleText ?? "";
  for (const [re, spelling] of [[WITHOUT, "without X"], [NON, "non-X"]] as const) {
    for (const m of text.matchAll(re)) {
      const sentence = text.slice(Math.max(0, m.index - 70), m.index + 70).replace(/\n/g, " | ");
      hits.push({ name: c.name, keyword: m[1].toLowerCase(), spelling, sentence, derived: derivedIds.has(c._id) });
    }
  }
}

const by = <T>(k: (h: Hit) => T) => {
  const m = new Map<T, number>();
  for (const h of hits) m.set(k(h), (m.get(k(h)) ?? 0) + 1);
  return [...m].sort((a, b) => (b[1] as number) - (a[1] as number));
};

console.log(`matches ${hits.length} over ${new Set(hits.map((h) => h.name)).size} cards; ${hits.filter((h) => h.derived).length} matches in the DERIVED corpus`);
console.log(`\nby spelling:`);
for (const [s, n] of by((h) => h.spelling)) console.log(`  ${String(n).padStart(4)}  ${s}`);
console.log(`\nby keyword:`);
for (const [k, n] of by((h) => h.keyword)) console.log(`  ${String(n).padStart(4)}  ${k}`);

// WHAT SHAPE is the sentence? A keyword's own REMINDER text mentions the negation (first strike,
// flanking) and is not a subject at all; a "can't block" restriction states no action the engine
// derives. Only a trigger or a continuous effect gated on the absence is a real demand.
const shapeOf = (h: Hit): string => {
  const s = h.sentence.toLowerCase();
  if (/\((?:this|whenever)[^)]*without/.test(s) || /\bthis creature deals combat damage before\b/.test(s)) return "own reminder text";
  if (/can't|cannot/.test(s)) return "restriction (can't ...)";
  if (/\bwhen(ever)?\b|\bat the beginning\b/.test(s)) return "TRIGGER subject";
  if (/\bdestroy|exile|deals? \d|target\b/.test(s)) return "removal/target";
  return "other";
};
console.log(`\nby sentence shape:`);
{
  const m = new Map<string, number>();
  for (const h of hits) m.set(shapeOf(h), (m.get(shapeOf(h)) ?? 0) + 1);
  for (const [s, n] of [...m].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${s}`);
  console.log(`\n  TRIGGER subjects, corpus-wide:`);
  for (const h of hits.filter((x) => shapeOf(x) === "TRIGGER subject"))
    console.log(`    ${h.derived ? "DERIVED " : "        "}${h.name} [${h.keyword}] ...${h.sentence}...`);
}

// Does the card actually CONSUME anything? Count the ones whose derived record has a trigger or a
// static — a demand nobody reads is not worth a schema slot. Count the consumers, not the cards.
console.log(`\nDERIVED-CORPUS cards carrying one, with what they derive:`);
for (const name of [...new Set(hits.filter((h) => h.derived).map((h) => h.name))].sort()) {
  const c = cards.find((x) => x.name === name)!;
  const d = await store.db.collection(DERIVED_COLLECTION).findOne({ oracleId: c._id } as never) as unknown as
    { abilities?: Ability[] } | null;
  const kinds = (d?.abilities ?? []).map((a) => `${(a.trigger?.verbs ?? []).join("/") || a.kind}->${a.effect?.kind}`);
  const h = hits.find((x) => x.name === name)!;
  console.log(`  ${name}  [${h.spelling}: ${h.keyword}]\n     ${kinds.join(" · ") || "(nothing)"}\n     ...${h.sentence}...`);
}

await store.close();
process.exit(0);
