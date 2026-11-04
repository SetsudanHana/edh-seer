/** FREE, READ-ONLY (#1485). Argues every lost and gained pair of a `derive-impact --json` file: for each changed card, each counterpart's trigger is
 *  classified self / class / other from the compact `rows` the JSON carries (never Mongo). See loss-classify-core.ts for the rules.
 *
 *  Usage: npx tsx packages/instruments/src/loss-classify.ts <impact.json> [--card "Name"]
 *  Exit: 0 printed; 2 bad usage, a JSON with no `pairRows` (made before #1485: re-run derive-impact --json), or one where most pairs have no row. */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { classifyReport, formatClassified, inputProblem, noRowProblem, type ImpactJson } from "./loss-classify-core.js";

const { positionals, values } = parseArgs({ allowPositionals: true, strict: true, options: { card: { type: "string" } } });
if (positionals.length !== 1) { console.error('usage: loss-classify.ts <impact.json> [--card "Name"]'); process.exit(2); }
const data = JSON.parse(readFileSync(positionals[0]!, "utf8")) as ImpactJson;
const bad = inputProblem(data);
if (bad) { console.error(`loss-classify: ${bad}`); process.exit(2); }
const report = classifyReport(data, values.card);
const empty = noRowProblem(report);
if (empty) { console.error(`loss-classify: ${empty}`); process.exit(2); }
console.log(formatClassified(report));
