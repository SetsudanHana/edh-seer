/** FREE, no database. Which construction blocks each stored action the action grammar does not read
 *  (#896). See `action-blockers-core.ts`.
 *
 *    npx tsx packages/instruments/src/action-blockers.ts packages/tagger/src/grammar/action.ts
 *    EXAMPLES=0 npx tsx packages/instruments/src/action-blockers.ts <parser module>   # the table alone
 *
 *  The parser module exports `parseActions`, as for `action-diff.ts`.
 *
 *  Output goes to `docs/measurements/card-grammar/` (local-only). Run from the repo root. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { blockers, type UnreadOf } from "./action-blockers-core.js";
import { readActions, type ActionParser } from "./action-diff-core.js";

const OUT = "docs/measurements/card-grammar";
const rows = readActions(gunzipSync(readFileSync("packages/tagger/actions.jsonl.gz")).toString("utf8"));
const mod = await import(pathToFileURL(resolve(process.argv[2] ?? "packages/tagger/src/grammar/action.ts")).href);
const b = blockers(rows, mod.parseActions as ActionParser, mod.unreadPhrases as UnreadOf | undefined);
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/action-blockers.json`, JSON.stringify(b, null, 1) + "\n");
const pct = (n: number) => `${(100 * n / (b.total.uses || 1)).toFixed(1)}%`.padStart(6);
console.log(`PRINTED-VERB COVERAGE (the 95% target, owner 2026-10-02): ${(100 * b.domain.read / (b.domain.uses || 1)).toFixed(1)}% (${b.domain.read} of ${b.domain.uses} uses)`);
console.log(`unread actions with printed text (not "other"): ${b.total.actions} distinct, ${b.total.uses} uses`);
for (const [k, v] of Object.entries(b.causes)) console.log(`${String(v).padStart(6)} ${pct(v)}  cause: ${k}`);
console.log(`\n  first  alone   construction  (first = attributed once, in catalogue order; alone = unblocked by this rewrite by itself)`);
for (const [k, v] of Object.entries(b.first).sort((x, y) => y[1] - x[1])) console.log(`${String(v).padStart(6)} ${String(b.single[k] ?? 0).padStart(6)} ${pct(v)}  ${k}`);
for (const [k, v] of Object.entries(b.single).filter(([k]) => !(k in b.first))) console.log(`${"0".padStart(6)} ${String(v).padStart(6)} ${pct(0)}  ${k}`);
console.log(`${String(b.combination).padStart(6)} ${"".padStart(6)} ${pct(b.combination)}  (several together)`);
console.log(`${String(b.unknown).padStart(6)} ${"".padStart(6)} ${pct(b.unknown)}  (unknown: no construction in the catalogue unblocks it)`);
const top = Number(process.env.TOP ?? 40);
console.log(`\nUNREAD PHRASES BY CONSTRUCTION: ${b.shapes.length} shapes; ${b.shapes.filter((x) => x.uses >= 5).length} with 5+ uses cover ${b.shapes.filter((x) => x.uses >= 5).reduce((n, x) => n + x.uses, 0)}`);
console.log(`\n  coarse (verb and the first words):`);
for (const h of b.heads.slice(0, top)) console.log(`${String(h.uses).padStart(6)} ${String(h.shapes).padStart(4) + " shapes"}  ${h.head}`);
console.log(`\n  fine (whole phrase):`);
for (const sh of b.shapes.slice(0, top)) console.log(`${String(sh.uses).padStart(6)} ${String(sh.texts).padStart(4) + " texts "}  ${sh.shape.slice(0, 120)}\n${" ".repeat(20)}e.g. ${sh.examples[0]!.slice(0, 120)}`);
const n = Number(process.env.EXAMPLES ?? 5);
if (n > 0) for (const [k, ex] of Object.entries(b.examples)) {
  console.log(`\n## ${k}`);
  for (const r of ex.slice(0, n)) console.log(`  ${String(r.cards).padStart(3)}  ${r.effect.slice(0, 150)}`);
}
console.log(`-> ${OUT}/action-blockers.json`);
