import { scratchDir } from "@edh-seer/data";
/** Scores a judged worksheet and prints the verdict on flat vs derived.
 *  Spec: `docs/superpowers/specs/2026-08-05-edge-precision-measurement-design.md` §6.
 *
 *  Reads the worksheet, the judgments, and the key. Opening the key is what ENDS the judging pass —
 *  run this only once judgments are committed to disk, or the ordering that makes the blinding
 *  meaningful is broken.
 *
 *  Usage: tsx src/bin/precision-score.ts [--dir /tmp/precision] */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  beatsBeyondNoise, countingGenericAsReal, leakyTags, score,
  type Judgment, type Source, type SourceScore,
} from "./precision-core.js";

const arg = (flag: string, fallback: string): string => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const DIR = arg("--dir", scratchDir("precision"));

const lines = (f: string): unknown[] =>
  readFileSync(join(DIR, f), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

interface Row { id: number; tag: string; derivedDocs: [boolean, boolean] }
const rows = lines("worksheet.jsonl") as Row[];
const judgments = lines("judgments.jsonl") as Judgment[];
const keyFile = JSON.parse(readFileSync(join(DIR, "key.json"), "utf8")) as {
  seed: number; n: number; pool: Record<Source, number>; bySource: Record<string, Source>;
};

const key = new Map<number, Source>(
  Object.entries(keyFile.bySource).map(([id, s]) => [Number(id), s]),
);
const tagOf = new Map(rows.map((r) => [r.id, r.tag]));
const cleanRows = new Set(rows.filter((r) => r.derivedDocs.every(Boolean)).map((r) => r.id));

const pct = (v: number | null): string => (v === null ? "  n/a" : `${(v * 100).toFixed(1)}%`);
const band = (s: SourceScore): string =>
  s.interval ? `[${pct(s.interval[0])}, ${pct(s.interval[1])}]` : "[n/a]";

function line(label: string, scores: Record<Source, SourceScore>): void {
  const f = scores.flat, d = scores.derived;
  console.log(
    `  ${label.padEnd(34)} flat ${pct(f.precision)} ${band(f).padEnd(18)}`
    + ` derived ${pct(d.precision)} ${band(d)}`,
  );
}

const judgedIds = new Set(judgments.map((j) => j.id));
const missing = rows.filter((r) => !judgedIds.has(r.id)).length;

console.log(`\nedge precision — seed ${keyFile.seed}, ${judgments.length}/${rows.length} rows judged`);
if (missing) console.log(`  WARNING: ${missing} rows unjudged; every figure below is partial.`);
console.log(`  pools: flat ${keyFile.pool.flat.toLocaleString()} reasons,`
  + ` derived ${keyFile.pool.derived.toLocaleString()}`);

const headline = score(judgments, key);
console.log("");
line("1. headline (generic = false)", headline);
line("2. generic counted as real", score(countingGenericAsReal(judgments), key));
line("3. excluding flat-fallback rows", score(judgments.filter((j) => cleanRows.has(j.id)), key));

const leaked = leakyTags(key, tagOf);
const leakRows = judgments.filter((j) => !leaked.has(tagOf.get(j.id) ?? ""));
const withoutLeak = score(leakRows, key);
line("4. excluding leak-prone tags", withoutLeak);
console.log(`     (${leaked.size} tags appeared in one arm only,`
  + ` ${judgments.length - leakRows.length} rows dropped)`);

for (const source of ["flat", "derived"] as const) {
  const s = headline[source];
  console.log(`\n  ${source}: real ${s.real}, false ${s.false}, uncertain ${s.uncertain}`);
  const causes = Object.entries(s.causes).sort((a, b) => b[1] - a[1]);
  if (causes.length) console.log(`    false by cause: ${causes.map(([c, n]) => `${c} ${n}`).join(", ")}`);
}

const verdict = beatsBeyondNoise(headline);
const leakVerdict = beatsBeyondNoise(withoutLeak);
console.log("");
if (verdict === null) {
  console.log("VERDICT: not enough decided rows to say anything. Do not switch.");
} else if (verdict !== leakVerdict) {
  // Spec §6.4: the leak audit is not decoration. If it can flip the answer, the blinding was not
  // good enough to carry this decision and the honest report is that there is no verdict.
  console.log("VERDICT: WITHHELD — dropping leak-prone tags changes the answer, so the blinding is"
    + " not strong enough to carry this decision. Fix the leak and re-draw.");
} else if (verdict) {
  console.log("VERDICT: derived beats flat beyond sampling noise. The pre-registered rule says"
    + " switch TAGS_SOURCE to derived.");
} else {
  console.log("VERDICT: derived does NOT beat flat beyond sampling noise. The pre-registered rule"
    + " says do not switch.");
}
