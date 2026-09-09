/** SCORE A MAGNITUDE DRAW once the owner's rankings are on disk: opens the sealed key, computes the
 *  pairwise concordance of each engine ordering (today's weight, the §2 product) with the owner's
 *  rankings, per width stratum and pooled, with a Wilson 95% interval; reports the tripwire (owner
 *  ties in the narrow stratum) and the pre-registered rule. Free, read-only, no Mongo.
 *
 *    npx tsx research/instruments/magnitude-score.ts docs/measurements/2026-09-09-magnitude-v1 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { concordance } from "../../packages/instruments/src/magnitude-core.js";
import { wilson } from "../../packages/instruments/src/precision-core.js";

const dir = process.argv[2];
if (!dir) { console.error("usage: magnitude-score.ts <draw dir>"); process.exit(2); }
interface KeyRow { id: number; deck: string; consumer: string; width: string; discriminated?: boolean; feeders: { name: string; today: number; product: number }[] }
const key = JSON.parse(readFileSync(join(dir, "key.json"), "utf8")) as { rows: KeyRow[] };
const rankings = new Map(readFileSync(join(dir, "rankings.jsonl"), "utf8").trim().split("\n").filter(Boolean)
  .map((l) => JSON.parse(l) as { id: number; ranks: number[]; note?: string }).map((r) => [r.id, r]));
const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;

const totals: Record<string, Record<string, { agree: number; pairs: number }>> = {};
let ties = 0, narrowPairs = 0, judged = 0;
for (const row of key.rows) {
  const r = rankings.get(row.id);
  if (!r) continue;
  judged++;
  for (const model of ["today", "product"] as const) {
    const c = concordance(r.ranks, row.feeders.map((f) => f[model]));
    for (const bucket of [row.width, row.discriminated ? "discriminated" : "engine-tied", "all"]) {
      totals[bucket] ??= {};
      totals[bucket][model] ??= { agree: 0, pairs: 0 };
      totals[bucket][model].agree += c.agree; totals[bucket][model].pairs += c.pairs;
    }
  }
  if (row.width === "narrow") { narrowPairs += 3; ties += 3 - concordance(r.ranks, [1, 2, 3]).pairs; }
}
console.log(`draw ${dir}: ${judged} of ${key.rows.length} rows ranked\n`);
console.log("stratum        model     agree/pairs   concordance [95% CI]");
for (const bucket of ["narrow", "type", "wide", "discriminated", "engine-tied", "all"]) for (const model of ["today", "product"]) {
  const t = totals[bucket]?.[model]; if (!t) continue;
  const [lo, hi] = wilson(Math.round(t.agree), t.pairs);
  console.log(`${bucket.padEnd(14)} ${model.padEnd(9)} ${String(t.agree).padStart(6)}/${String(t.pairs).padEnd(5)} ${pct(t.agree / t.pairs)} [${pct(lo)}, ${pct(hi)}]`);
}
const tieRate = narrowPairs ? ties / narrowPairs : 0;
console.log(`\ntripwire: owner ties in the narrow stratum ${pct(tieRate)} of pairs${tieRate >= 0.25 ? " -- TRIPPED, the worksheet is wrong, do not read the rule" : ""}`);
const a = totals.all?.today, b = totals.all?.product;
if (a && b && tieRate < 0.25) {
  const [, hiA] = wilson(Math.round(a.agree), a.pairs), [loB] = wilson(Math.round(b.agree), b.pairs);
  console.log(`rule: ship the product if its interval clears today's -- ${loB > hiA ? "CLEARS" : "does NOT clear"} (product lower ${pct(loB)} vs today upper ${pct(hiA)}); the three engine gates are checked separately`);
}
