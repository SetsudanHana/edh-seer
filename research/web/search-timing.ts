import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EventQuery } from "../../packages/web/client/src/lib/facets.js";
import { evaluate, type Node } from "../../packages/web/client/src/lib/search/evaluate.js";
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

// ---- the Infinite Diversity question, through the page's own path (#1782) ------------------------------------------
// /cards?type=creature&notsubtype=borg&creaturetypesmin=3&colors=WUG&sort=creaturetypes
// Core views from the rows, then the real catalogue and its named lists through the loader (a fetch shim over
// static-out), then the same evaluator, count and ordering the page uses.
import { readFileSync as readText } from "node:fs";
import { eventsFromParams } from "../../packages/web/client/src/lib/facets.js";
import { evaluateEventQuery, rowCountsOf, withEveryCreatureType } from "../../packages/web/client/src/lib/search/from-event-query.js";
import { createSearchLoader, withCatalogue } from "../../packages/web/client/src/lib/search/load.js";

const shim = (async (u: string | URL | Request) => {
  const path = join(root, String(u).replace(/^\/static\//, ""));
  try {
    const body = readText(path, "utf8");
    return { ok: true, json: async () => JSON.parse(body) } as Response;
  } catch { return { ok: false, json: async () => ({}) } as Response; }
}) as typeof fetch;
const url = "type=creature&notsubtype=borg&creaturetypesmin=3&colors=WUG&sort=creaturetypes";
const q = eventsFromParams(new URLSearchParams(url));
const page = async (keep: boolean) => {
  const t0 = performance.now();
  const core = coreContext(file.cards, file);
  const need: Node = { and: [{ field: "st", op: "countIn", list: "creature", min: 0 }] };
  const loaded = withEveryCreatureType(await withCatalogue(core, createSearchLoader("/static", shim), need), file.cards, file);
  const t1 = performance.now();
  const res = evaluateEventQuery(file.cards, file, keep ? { ...q, keepChangelings: true } : q, "cards", { context: loaded });
  if (!res.ok) throw new Error(`cannot answer: ${res.cannotAnswer.join("; ")}`);
  const counts = rowCountsOf(loaded, "creaturetypes")!;
  const names = (file.cards as unknown as { name: string }[]);
  const order = [...res.rows].sort((a, b) => counts[b]! - counts[a]! || names[a]!.name.localeCompare(names[b]!.name, "en"));
  return { rows: order, ms: performance.now() - t1, setup: t1 - t0, counts, names };
};
const normal = await page(false);
const kept = await page(true);
const every = new Set(kept.rows.filter((r) => !normal.rows.includes(r)));
console.log(`\n/cards?${url}`);
console.log(`catalogue + lists + views (once) ${normal.setup.toFixed(1)} ms; evaluate+count ${normal.ms.toFixed(2)} ms`);
console.log(`count ${normal.rows.length}; with changelings kept ${kept.rows.length}; changelings hidden ${every.size}`);
console.log(`top 5: ${normal.rows.slice(0, 5).map((r) => `${normal.names[r]!.name} (${normal.counts[r]})`).join("; ")}`);
