/** Re-scores an ALREADY-JUDGED sample against the current engine, without re-judging.
 *
 *  Valid only for a change that can only REMOVE edges (a gate), never add them: the surviving subset
 *  of a random sample is itself a random sample of the filtered population, so the old labels carry
 *  over. A change that creates new edges needs a fresh draw, because the new rows were never
 *  eligible to be judged.
 *
 *  Usage: tsx src/bin/precision-recheck.ts [--dir /tmp/precision] */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames,
} from "@edh-seer/data";
import { ComboIndex } from "@edh-seer/engine";
import { createTagsLookup } from "@edh-seer/tagger";
import { analyzeDeckStructured, buildDeckCards, type CardTagsLookup } from "../index.js";
import { readdirSync } from "node:fs";
import { beatsBeyondNoise, score, type Judgment, type Source } from "./precision-core.js";

const DIR = "packages/cli/decks/calibration";
const arg = (flag: string, fallback: string): string => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = arg("--dir", "/tmp/precision");

const lines = (f: string): unknown[] =>
  readFileSync(join(OUT, f), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

interface Row { id: number; producer: string; consumer: string; tag: string }
const rows = lines("worksheet.jsonl") as Row[];
const judgments = lines("judgments.jsonl") as Judgment[];
const keyFile = JSON.parse(readFileSync(join(OUT, "key.json"), "utf8")) as {
  bySource: Record<string, Source>; byDeck: Record<string, string>;
};
const key = new Map<number, Source>(
  Object.entries(keyFile.bySource).map(([id, s]) => [Number(id), s]),
);

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const sources: Record<Source, CardTagsLookup> = {
  flat: createTagsLookup(store.db, "flat"),
  derived: createTagsLookup(store.db, "derived-first"),
};

/** Every (source, deck, producer, consumer, tag) the engine produces TODAY. */
const live = new Set<string>();
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort()) {
  const deck = file.replace(/\.txt$/, "");
  const sections = parseDecklistSections(readFileSync(join(DIR, file), "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmdNorm = new Set(sections.commanders.map(normalizeName));
  const commanderNames = cards.filter((c) => cmdNorm.has(normalizeName(c.name))).map((c) => c.name);
  for (const source of ["flat", "derived"] as const) {
    const deckCards = await buildDeckCards(cards, lookup, sources[source]);
    const report = analyzeDeckStructured(
      deckCards, commanderNames, undefined, undefined, new ComboIndex(combos),
    );
    for (const edge of report.edges) {
      for (const r of edge.reasons) {
        if (!r.producer || !r.consumer) continue;
        live.add(`${source}|${deck}|${r.producer}|${r.consumer}|${r.tag}`);
      }
    }
  }
  process.stdout.write(".");
}

const rowById = new Map(rows.map((r) => [r.id, r]));
const survivors: Judgment[] = [];
let dropped = 0;
const droppedByVerdict: Record<string, number> = {};
for (const j of judgments) {
  const row = rowById.get(j.id);
  const source = key.get(j.id);
  const deck = keyFile.byDeck[String(j.id)];
  if (!row || !source || !deck) continue;
  if (live.has(`${source}|${deck}|${row.producer}|${row.consumer}|${row.tag}`)) survivors.push(j);
  else {
    dropped++;
    const label = `${source}/${j.verdict}${j.cause ? `:${j.cause}` : ""}`;
    droppedByVerdict[label] = (droppedByVerdict[label] ?? 0) + 1;
  }
}

const pct = (v: number | null): string => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const before = score(judgments, key);
const after = score(survivors, key);

console.log(`\n\nre-check on the already-judged sample (no re-judging)`);
console.log(`  rows still produced by the engine: ${survivors.length}/${judgments.length}`
  + ` (${dropped} dropped)`);
console.log(`\n  dropped rows by what they were judged:`);
for (const [k, n] of Object.entries(droppedByVerdict).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(34)} ${n}`);
}
for (const source of ["flat", "derived"] as const) {
  const b = before[source], a = after[source];
  console.log(`\n  ${source}: ${pct(b.precision)} -> ${pct(a.precision)}`
    + `  (real ${b.real}->${a.real}, false ${b.false}->${a.false})`);
  if (a.interval) console.log(`    interval now [${pct(a.interval[0])}, ${pct(a.interval[1])}]`);
}
// What is LEFT is the punch list: the false rows the change did not reach, grouped so the next
// fix can be aimed rather than guessed at.
const remaining = new Map<string, number>();
for (const j of survivors) {
  if (j.verdict !== "false") continue;
  const row = rowById.get(j.id)!;
  const k = `${key.get(j.id)}/${j.cause ?? "unlabelled"}/${row.tag}`;
  remaining.set(k, (remaining.get(k) ?? 0) + 1);
}
console.log(`\n  surviving FALSE rows by source/cause/tag (top 12):`);
for (const [k, n] of [...remaining].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`    ${k.padEnd(46)} ${n}`);
}

const verdict = beatsBeyondNoise(after);
console.log(`\n  derived still beats flat beyond noise: ${verdict === null ? "n/a" : verdict}`);
await store.close();
