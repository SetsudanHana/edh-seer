/** Ten-trial harness, generalised over deck fixture x preset x params. Same trial body as the
 *  acceptance test (board-trial.ts); adds motion metrics -- the "walk" the measurements doc
 *  §Task5 found, which the acceptance table is blind to.
 *
 *  Usage: npx tsx board-layout.harness.ts <fixture.json> [ticks] */
import { readFileSync } from "node:fs";
import { boardTrial, type TrialFixture } from "./board-trial.js";
import type { BoardParams } from "./board-force.js";
import { PRESETS } from "./presets.js";

function mean(xs: readonly number[]) { return xs.reduce((a, b) => a + b, 0) / (xs.length || 1); }
function sum(xs: readonly number[]) { return xs.reduce((a, b) => a + b, 0); }

const fixturePath = process.argv[2];
const ticks = Number(process.argv[3] ?? 800);
const fx = JSON.parse(readFileSync(fixturePath, "utf8")) as TrialFixture;

/** Edit freely -- being able to add an arm in one line is this file's whole point. `pin: false`
 *  reproduces the board as it was before holdCardCentroid shipped, which is how every "before"
 *  drift number in the review brief was measured. */
const ARMS: { name: string; params: Partial<BoardParams>; pin: boolean }[] = [
  { name: "pre-pin", params: {}, pin: false },
  { name: "shipped", params: {}, pin: true },
];

const rows: string[] = [];
for (const arm of ARMS) {
  for (let p = 0; p < PRESETS.length; p++) {
    const trial = boardTrial(fx, { presetIndex: p, params: arm.params, ticks, pin: arm.pin, motionTicks: 180 });
    const t = Array.from({ length: 10 }, (_, i) => trial(i + 1));
    rows.push([
      arm.name.padEnd(9),
      PRESETS[p].label.padEnd(11),
      String(t[0].rooms).padStart(5),
      String(sum(t.map((x) => x.escapes.one))).padStart(11),
      String(sum(t.map((x) => x.overlaps))).padStart(8),
      String(sum(t.map((x) => x.intrusions))).padStart(10),
      String(sum(t.map((x) => x.unresolved))).padStart(10),
      String(sum(t.map((x) => x.escapes.two))).padStart(11),
      String(sum(t.map((x) => x.escapes.threePlus))).padStart(10),
      mean(t.map((x) => x.motionMean)).toFixed(2).padStart(10),
      mean(t.map((x) => x.motionMax)).toFixed(2).padStart(9),
      mean(t.map((x) => x.drift)).toFixed(2).padStart(8),
    ].join(" "));
  }
}
console.log([
  "arm      ", "preset     ", "rooms", "escapes.one", "overlaps", "intrusions",
  "unresolved", "escapes.two", "escapes.3+", "motionMean", "motionMax", "drift",
].join(" "));
console.log(rows.join("\n"));
console.log(`\ncards ${boardTrial(fx, { ticks: 1 })(1).cards} · ticks ${ticks} · 10 trials/arm · motion over 180 further ticks`);
