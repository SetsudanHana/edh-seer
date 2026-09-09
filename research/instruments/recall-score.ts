/** SCORE A RECALL DRAW once the judgments are on disk: opens the sealed key, joins each judgment to
 *  its stratum, prints the per-stratum table with a Wilson 95% interval and the population-weighted
 *  pooled recall (`pooledRecall`, never raw pooling — spec §5). Free, read-only, no Mongo.
 *
 *    npx tsx research/instruments/recall-score.ts docs/measurements/2026-09-09-recall-v4 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pooledRecall, scoreRecall, type RecallJudgment, type Stratum } from "../../packages/instruments/src/recall-core.js";

const dir = process.argv[2];
if (!dir) throw new Error("usage: recall-score.ts <draw dir>");
const key = JSON.parse(readFileSync(join(dir, "key.json"), "utf8")) as { population: Record<Stratum, number>; byStratum: Record<string, Stratum>; seed: number; n: number };
const judgments = readFileSync(join(dir, "judgments.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as RecallJudgment);
const rows = readFileSync(join(dir, "worksheet.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { id: number; a: string; b: string });
const names = new Map(rows.map((r) => [r.id, `${r.a} / ${r.b}`]));

const wilson = (k: number, n: number): [number, number] => {
  if (n === 0) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
};
const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;

const byStratum: Record<Stratum, RecallJudgment[]> = { "verb-match": [], "derive-empty": [], base: [] };
for (const j of judgments) byStratum[key.byStratum[String(j.id)]!].push(j);

console.log(`draw ${dir}: seed ${key.seed}, ${key.n} per stratum, ${judgments.length} judgments\n`);
console.log("stratum         n   silence  expressible  inexpressible  uncertain   miss rate [95% CI]");
for (const s of ["verb-match", "derive-empty", "base"] as Stratum[]) {
  const sc = scoreRecall(byStratum[s]);
  const [lo, hi] = wilson(sc.missExpressible, sc.decided);
  console.log(`${s.padEnd(14)} ${String(byStratum[s].length).padStart(3)}   ${String(sc.correctSilence).padStart(6)}  ${String(sc.missExpressible).padStart(11)}  ${String(sc.missInexpressible).padStart(13)}  ${String(sc.uncertain).padStart(9)}   ${pct(1 - (sc.recall ?? 1)).padStart(6)} [${pct(lo)}, ${pct(hi)}]`);
}
const pooled = pooledRecall((["verb-match", "derive-empty", "base"] as Stratum[]).map((s) => ({ population: key.population[s], judgments: byStratum[s] })));
console.log(`\npopulation-weighted recall: ${pooled === null ? "n/a" : pct(pooled)}  (populations ${JSON.stringify(key.population)})`);
console.log(`\nmisses, by stratum:`);
for (const s of ["verb-match", "derive-empty", "base"] as Stratum[]) {
  for (const j of byStratum[s]) if (j.verdict === "miss-expressible" || j.verdict === "miss-inexpressible") {
    console.log(`  [${s}] #${j.id} ${j.verdict.replace("miss-", "")}: ${names.get(j.id)} — ${j.note}`);
  }
}
