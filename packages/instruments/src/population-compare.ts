/** Flat tags vs derived tags across ALL 71 calibration decks. Free: no API, no writes.
 *
 *  The persistence work was validated on ONE deck, which is not enough to judge a corpus that cost
 *  ~$9.6 — a sacrifice deck cannot move on card-selection effects, so a null result there says
 *  nothing about card selection. These 71 decks are the same ones the calibration corpus was drawn
 *  from, so coverage is near-total rather than the ~50% an arbitrary new deck gets, and any
 *  difference is the tag population rather than a coverage artifact.
 *
 *  Reports per deck and in aggregate: edges, reasons, and whether the deck's named theme changed.
 *  A theme flip is the loudest signal available — it means the two populations disagree about what
 *  the deck IS, which matters far more than a few edges either way.
 *
 *  Usage: npx tsx packages/instruments/src/population-compare.ts [--verbose] */
import { readdirSync } from "node:fs";
import { CALIBRATION_DECKS } from "@edh-seer/data";
import { mapInWorkers } from "@edh-seer/data/parallel";
import type { MeshGroup } from "@edh-seer/matcher/mesh";
import type { DeckResult, Row } from "./population-compare-worker.js";

const DIR = process.argv[2]?.startsWith("--") ? CALIBRATION_DECKS : (process.argv[2] ?? CALIBRATION_DECKS);
const VERBOSE = process.argv.includes("--verbose");

// EVERY DECK ON ITS OWN CORE (owner 2026-09-29): 107 s on one core of ten before. The per-deck work
// lives in the worker; results come back in deck order, so every figure below is what the sequential
// run printed.
const files = readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort();
const results = await mapInWorkers<{ dir: string; file: string }, DeckResult>(
  files.map((file) => ({ dir: DIR, file })), new URL("./population-compare-worker.ts", import.meta.url));
const rows: Row[] = results.map((r) => r.row);
const meshGroups: [MeshGroup[], MeshGroup[]] = [results.flatMap((r) => r.mesh[0]), results.flatMap((r) => r.mesh[1])];
process.stdout.write(".".repeat(rows.length));

const sum = (f: (r: Row) => number): number => rows.reduce((n, r) => n + f(r), 0);
const flips = rows.filter((r) => r.theme[0] !== r.theme[1]);
const lostReasons = rows.filter((r) => r.reasons[1] < r.reasons[0]);

console.log(`\n\n${rows.length} decks\n`);
console.log(`  coverage by the derived corpus: ${(100 * sum((r) => r.covered) / sum((r) => r.total)).toFixed(1)}%`);
console.log(`  edges    flat ${sum((r) => r.edges[0])}  ->  derived ${sum((r) => r.edges[1])}`);
console.log(`  reasons  flat ${sum((r) => r.reasons[0])}  ->  derived ${sum((r) => r.reasons[1])}`);
// Volume alone cannot judge this: a mesh is the cheapest reason there is, so the population that
// meshes hardest wins on the raw count. See mesh.ts.
console.log(`    of which MESHED  flat ${sum((r) => r.meshed[0])}  ->  derived ${sum((r) => r.meshed[1])}`);
console.log(`    CLEAN            flat ${sum((r) => r.clean[0])}  ->  derived ${sum((r) => r.clean[1])}`);
const cleanLoss = rows.filter((r) => r.clean[1] < r.clean[0]);
console.log(`  decks losing CLEAN reasons: ${cleanLoss.length}/${rows.length}`);
for (const [i, label] of [[0, "flat"], [1, "derived"]] as const) {
  const worst = [...meshGroups[i]].sort((x, y) => y.fanOut - x.fanOut).slice(0, 5);
  console.log(`  widest ${label} meshes: ${worst.map((g) => `${g.producer} ${g.tag} x${g.fanOut}`).join(", ") || "(none)"}`);
}
console.log(`  decks where derived finds FEWER reasons: ${lostReasons.length}/${rows.length}`);
console.log(`  decks whose top theme CHANGED: ${flips.length}/${rows.length}`);
for (const f of flips.slice(0, 15)) console.log(`      ${f.deck.padEnd(38)} ${f.theme[0]} -> ${f.theme[1]}`);

if (VERBOSE) {
  console.log(`\nper deck (reasons flat -> derived):`);
  for (const r of [...rows].sort((x, y) => (x.reasons[1] - x.reasons[0]) - (y.reasons[1] - y.reasons[0]))) {
    const d = r.reasons[1] - r.reasons[0];
    console.log(`  ${r.deck.padEnd(38)} ${String(r.reasons[0]).padStart(4)} -> ${String(r.reasons[1]).padStart(4)}  ${d >= 0 ? "+" : ""}${d}`);
  }
}
