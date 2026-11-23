import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EventQuery } from "../../packages/web/client/src/lib/facets.js";
import { evaluate } from "../../packages/web/client/src/lib/search/evaluate.js";
import { coreContext, fromEventQuery, type CoreRow } from "../../packages/web/client/src/lib/search/from-event-query.js";

/** TIMES THE AST PATH on the five characteristic queries compileCharacteristics was measured on (#1782):
 *  evaluation only, over the real name index, 50-run average; the view build is timed once, apart.
 *
 *    npx tsx research/web/search-timing.ts [static-out]
 */
const root = process.argv[2] ?? "static-out";
const { version } = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as { version: string };
const file = JSON.parse(readFileSync(join(root, version, "name-index.json"), "utf8")) as
  { types: string[]; subtypes: string[]; keywords: string[]; cards: CoreRow[] };
const base: EventQuery = { produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [] };
const queries: [string, Partial<EventQuery>][] = [
  ["creature", { types: ["creature"] }],
  ["creature + elf", { types: ["creature"], subtypes: ["elf"] }],
  ["instant mv<=2", { types: ["instant"], mvMax: 2 }],
  ["flying pow>=3", { keywords: ["flying"], powMin: 3 }],
  ["blue artifact", { types: ["artifact"], cardColours: ["U"] }],
];
let t = performance.now();
const ctx = coreContext(file.cards, file);
console.log(`rows ${file.cards.length}; view build (once) ${(performance.now() - t).toFixed(1)} ms`);
const RUNS = 50;
for (const [name, over] of queries) {
  const node = fromEventQuery({ ...base, ...over }, "cards");
  let count = -1;
  t = performance.now();
  for (let i = 0; i < RUNS; i++) { const r = evaluate(node, ctx); count = r.ok ? r.rows.length : -1; }
  console.log(`${name.padEnd(16)} ${String(count).padStart(6)}  ${((performance.now() - t) / RUNS).toFixed(3)} ms`);
}
