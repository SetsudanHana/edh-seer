import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultTarget } from "../../packages/web/client/src/lib/precon-upgrades.js";

/** DOES THE PRECON PACKAGE CLOSE THE ROLE GAPS THE REPORT NAMES? (#1137) For every precon page in a
 *  directory (a build-precons output, flat or `p-<hash>`): the default-target package's role groups
 *  short before (the page's `gaps`) and after (`after.short`), and the shortfall cards left.
 *
 *    npx tsx research/web/precon-gap-census.ts <precons dir>
 */
const dir = process.argv[2]!;
let pages = 0, shortBefore = 0, shortAfter = 0, cardsBefore = 0, cardsAfter = 0, closedAll = 0;
const sample: string[] = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && x !== "index.json" && x !== "build-stamp.json")) {
  const p = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const t = defaultTarget(p);
  const k = p.packages?.find((x: { target: number }) => x.target === t);
  if (!k?.after?.short) continue;
  pages++;
  const before = (p.gaps ?? []) as { group: string; have: number; target: number }[];
  const after = k.after.short as { group: string; have: number; target: number }[];
  if (before.length) shortBefore++;
  if (after.length) shortAfter++;
  if (before.length && !after.length) closedAll++;
  cardsBefore += before.reduce((n, g) => n + (g.target - g.have), 0);
  cardsAfter += after.reduce((n, g) => n + (g.target - g.have), 0);
  if (/party-time/.test(f)) sample.push(`${f}: before ${before.map((g) => `${g.group} ${g.have}/${g.target}`).join(", ")} | after ${after.map((g) => `${g.group} ${g.have}/${g.target}`).join(", ") || "none"}`);
}
console.log(`${pages} precons: a role short before ${shortBefore}, after the default package ${shortAfter}; cards short in total ${cardsBefore} -> ${cardsAfter}; every gap closed in ${closedAll}`);
for (const s of sample) console.log("  " + s);
