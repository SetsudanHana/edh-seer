/** Ten-trial harness over deck fixture x preset x params. Same trial body as the acceptance test
 *  (board-trial.ts); adds motion metrics -- the "walk" the measurements doc §Task5 found, which the
 *  acceptance table is blind to.
 *
 *  Usage:
 *    npx tsx board-layout.harness.ts                    every checked-in fixture
 *    npx tsx board-layout.harness.ts sorin inalla       named fixtures
 *    npx tsx board-layout.harness.ts --ticks 2400       longer settle
 *
 *  WHY MORE THAN ONE DECK. Every constant in board-force.ts was bracketed on inalla's role preset,
 *  and the two shapes that cost the most work this cycle -- near-identical rooms, and rooms nested
 *  inside other rooms -- appear on exactly one fixture each. A gate that reads one deck cannot tell
 *  a fix from a fit. The five below were chosen for structures they do NOT share:
 *
 *      sorin        Colour  2 rooms   Subtype near-identical pair (plains/swamp)
 *      inalla       Subtype 8 rooms   four rooms strictly NESTED inside `wizard`
 *      fairdrazi    Colour  5 rooms   maxK 5 -- the WUBRG card no circle grammar can satisfy
 *      changelings  Colour  3 rooms   changeling creature types
 *      braids       Colour  1 room    the universal-room case UNIVERSAL_ROOM_FRACTION guards
 *
 *  Runtime is minutes, not seconds: 5 fixtures x 5 presets x 10 trials x ~980 ticks. Name the one
 *  fixture you care about while iterating; run the whole set before changing a constant.
 */
import { readFileSync } from "node:fs";
import { boardTrial, type TrialFixture } from "./board-trial.js";
import type { BoardParams } from "./board-force.js";
import { PRESETS } from "./presets.js";
import { ACCEPTANCE, FIXTURES, type Caps } from "./board-acceptance.js";

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

/** Edit freely -- being able to add an arm in one line is this file's whole point. A second arm
 *  doubles the runtime across every fixture, so the default is one: the drift investigation that
 *  wanted a `pin: false` comparison is closed, and `pin` is still a TrialOptions field if it is
 *  ever needed again. */
const ARMS: { name: string; params: Partial<BoardParams> }[] = [
  { name: "shipped", params: {} },
];

const rows: string[] = [];
/** Both directions are failures. Over a cap is a regression; under it has to be banked by lowering
 *  the number, or the next regression hides in the slack. See board-acceptance.ts. */
const over: string[] = [];
const under: string[] = [];
const missing: string[] = [];

for (const name of fixtures) {
  const path = name.endsWith(".json") ? name : `../fixtures/${name}-graph.json`;
  const fx = JSON.parse(readFileSync(path, "utf8")) as TrialFixture;
  for (const arm of ARMS) {
    for (let p = 0; p < PRESETS.length; p++) {
      const trial = boardTrial(fx, { presetIndex: p, params: arm.params, ticks, motionTicks: 180 });
      const t = Array.from({ length: 10 }, (_, i) => trial(i + 1));
      const key = `${name}/${PRESETS[p].label}`;
      const got: Caps = {
        escapesOne: sum(t.map((x) => x.escapes.one)),
        overlaps: sum(t.map((x) => x.overlaps)),
        intrusions: sum(t.map((x) => x.intrusions)),
        unresolved: sum(t.map((x) => x.unresolved)),
        escapesTwo: sum(t.map((x) => x.escapes.two)),
      };
      const cap = ACCEPTANCE[key];
      if (cap === undefined) missing.push(key);
      else {
        for (const k of ["escapesOne", "overlaps", "intrusions", "unresolved", "escapesTwo"] as const) {
          if (got[k] > cap[k]) over.push(`${key} ${k} ${got[k]} > cap ${cap[k]}`);
          else if (got[k] < cap[k]) under.push(`${key} ${k} ${got[k]} < cap ${cap[k]} -- lower it`);
        }
      }
      const hard = {
        "escapes.one": got.escapesOne,
        overlaps: got.overlaps,
        intrusions: got.intrusions,
        unresolved: got.unresolved,
      };
      rows.push([
        name.padEnd(12),
        ARMS.length > 1 ? arm.name.padEnd(9) : "",
        PRESETS[p].label.padEnd(11),
        String(t[0].rooms).padStart(5),
        String(t[0].cards).padStart(5),
        String(hard["escapes.one"]).padStart(11),
        String(hard.overlaps).padStart(8),
        String(hard.intrusions).padStart(10),
        String(hard.unresolved).padStart(10),
        String(sum(t.map((x) => x.escapes.two))).padStart(11),
        String(sum(t.map((x) => x.escapes.threePlus))).padStart(10),
        mean(t.map((x) => x.motionMean)).toFixed(2).padStart(10),
        mean(t.map((x) => x.motionMax)).toFixed(2).padStart(9),
        mean(t.map((x) => x.drift)).toFixed(2).padStart(8),
      ].filter((s) => s !== "").join(" "));
    }
  }
}

console.log([
  "fixture     ", ...(ARMS.length > 1 ? ["arm      "] : []), "preset     ", "rooms", "cards",
  "escapes.one", "overlaps", "intrusions", "unresolved", "escapes.two", "escapes.3+",
  "motionMean", "motionMax", "drift",
].join(" "));
console.log(rows.join("\n"));

console.log(`\nticks ${ticks} · 10 trials · motion over 180 further ticks`);
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
