/** Ten-trial harness over deck fixture x params. Same trial body as the quality tests
 *  (board-trial.ts); adds motion metrics -- the "walk" the measurements doc found, which a settled
 *  snapshot is blind to.
 *
 *  Usage:
 *    npx tsx board-layout.harness.ts                    every checked-in fixture
 *    npx tsx board-layout.harness.ts sorin inalla       named fixtures
 *    npx tsx board-layout.harness.ts --ticks 2400       longer settle
 *
 *  WHY MORE THAN ONE DECK. Every constant in board-force.ts was bracketed on inalla, and a gate
 *  that reads one deck cannot tell a fix from a fit. The five fixtures differ in size (75-95 cards)
 *  and in how densely their synergies mesh (137-313 edges), which is the axis this board is now
 *  sensitive to.
 *
 *  CEILING: QUALITY_CAPS is empty until Task 6 fills it FROM these measurements, so every case
 *  reports NO CAP RECORDED and the exit code is non-zero. That is the intended pre-Task-6 state --
 *  a cap invented before anything was measured is a guess wearing a number.
 */
import { readFileSync } from "node:fs";
import { boardTrial, type TrialFixture } from "./board-trial.js";
import type { BoardParams } from "./board-force.js";
import { FIXTURES, QUALITY_CAPS, type Caps } from "./board-quality.js";

function mean(xs: readonly number[]) { return xs.reduce((a, b) => a + b, 0) / (xs.length || 1); }
function sum(xs: readonly number[]) { return xs.reduce((a, b) => a + b, 0); }

const argv = process.argv.slice(2);
const tickArg = argv.indexOf("--ticks");
const ticks = tickArg === -1 ? 800 : Number(argv[tickArg + 1]);
// `tickArg + 1` is only a value to skip when --ticks was actually given. Without the guard,
// tickArg is -1 and this drops argv[0] -- so `harness braids fairdrazi` silently ran fairdrazi
// alone, which is the worst kind of bug in a measurement tool: a quietly smaller sample.
const named = argv.filter((a, i) => !a.startsWith("--") && !(tickArg !== -1 && i === tickArg + 1));
const fixtures = named.length > 0 ? named : FIXTURES;

/** Edit freely -- being able to add an arm in one line is this file's whole point.
 *
 *  ONE ARM SHIPS, and the caps table is keyed on the bare fixture name, so leaving a second arm in
 *  here turns every key into `fixture/arm` and the gate reports NO CAP RECORDED for all of them.
 *  Add arms to measure, then take them out again. The Task 6 A/B that set LINK_DEGREE_NORM and
 *  LINK_STRENGTH_K is written up on QUALITY_CAPS; it ran
 *    shipped · degnorm · k012 · k0133 · degnorm-k1 · degnorm-k14 · degnorm-k2. */
const ARMS: { name: string; params: Partial<BoardParams> }[] = [
  { name: "shipped", params: {} },
];

const rows: string[] = [];
/** Both directions are failures. Over a cap is a regression; under it has to be banked by lowering
 *  the number, or the next regression hides in the slack. */
const over: string[] = [];
const under: string[] = [];
const missing: string[] = [];

for (const name of fixtures) {
  const path = name.endsWith(".json") ? name : `../fixtures/${name}-graph.json`;
  const fx = JSON.parse(readFileSync(path, "utf8")) as TrialFixture;
  for (const arm of ARMS) {
    const trial = boardTrial(fx, { params: arm.params, ticks, motionTicks: 180 });
    const t = Array.from({ length: 10 }, (_, i) => trial(i + 1));
    const key = ARMS.length > 1 ? `${name}/${arm.name}` : name;
    const got: Caps = {
      nodeOverlaps: sum(t.map((x) => x.nodeOverlaps)),
      cardOverlaps: sum(t.map((x) => x.cardOverlaps)),
      edgeCrossings: sum(t.map((x) => x.edgeCrossings)),
      linkDistError: Math.ceil(mean(t.map((x) => x.linkDistError))),
    };
    const free = t.flatMap((x) => x.hubFreedom);
    if (free.length > 0) over.push(`${key} hubFreedom ${free.length} non-card nodes: ${free[0]}`);
    const cap = QUALITY_CAPS[key];
    if (cap === undefined) missing.push(key);
    else {
      for (const k of ["nodeOverlaps", "cardOverlaps", "edgeCrossings", "linkDistError"] as const) {
        if (got[k] > cap[k]) over.push(`${key} ${k} ${got[k]} > cap ${cap[k]}`);
        else if (got[k] < cap[k]) under.push(`${key} ${k} ${got[k]} < cap ${cap[k]} -- lower it`);
      }
    }
    rows.push([
      name.padEnd(12),
      ARMS.length > 1 ? arm.name.padEnd(9) : "",
      String(t[0].cards).padStart(5),
      String(t[0].edges).padStart(5),
      String(got.nodeOverlaps).padStart(8),
      String(got.cardOverlaps).padStart(9),
      String(got.edgeCrossings).padStart(9),
      got.linkDistError.toFixed(0).padStart(9),
      mean(t.map((x) => x.driftMean)).toFixed(2).padStart(10),
      mean(t.map((x) => x.driftMax)).toFixed(2).padStart(9),
    ].filter((s) => s !== "").join(" "));
  }
}

console.log([
  "fixture     ", ...(ARMS.length > 1 ? ["arm      "] : []), "cards", "edges",
  "overlaps", "cardOverlap", "crossings", "distError", "driftMean", "driftMax",
].join(" "));
console.log(rows.join("\n"));

console.log(`\nticks ${ticks} · 10 trials · overlaps/crossings summed, distError meaned`);
// Name the case that moved rather than leaving it to be spotted in the table.
if (missing.length > 0) console.log(`NO CAP RECORDED (${missing.length}):\n  ${missing.join("\n  ")}`);
if (over.length > 0) console.log(`REGRESSED (${over.length}):\n  ${over.join("\n  ")}`);
if (under.length > 0) console.log(`IMPROVED, BANK IT (${under.length}):\n  ${under.join("\n  ")}`);
if (over.length + under.length + missing.length === 0) {
  console.log(`ON THE RATCHET across ${fixtures.length} fixtures -- every case exactly at its cap`);
} else {
  // Non-zero exit so this is usable as a gate rather than something someone has to read.
  process.exit(1);
}
