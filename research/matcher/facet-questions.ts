/** THE SHIP GATE FOR THE FACETS (spec 2026-09-08 part 4). Prints the two questions the owner asked,
 *  answered from the built artifact, so the PR body can carry them and the owner can judge. A
 *  one-shot that prints and writes nothing, so it lives in `research/` and imports by relative path.
 *  Run from the repo root: `npx tsx research/matcher/facet-questions.ts`. */
import { readFileSync } from "node:fs";
import { ARCHETYPE_LABELS } from "../../packages/matcher/src/archetype-vocabulary.js";
import { identityKeyOf } from "../../packages/matcher/src/bin/partners-core.js";

interface Row { s: string; i: string; c: 0 | 1; e: string[]; t: string[]; d: string[] }
const v = (JSON.parse(readFileSync("static-out/manifest.json", "utf8")) as { version: string }).version;
const rows = JSON.parse(readFileSync(`static-out/${v}/facet-index.json`, "utf8")) as Row[];
const names = new Map(
  (JSON.parse(readFileSync(`static-out/${v}/name-index.json`, "utf8")) as { slug: string; name: string }[])
    .map((e) => [e.slug, e.name]),
);
const fits = (identity: string, colours: string): boolean => [...identity].every((c) => colours.includes(c));
const side = (r: Row, a: string): string => (r.d.includes(a) ? "asks for it" : "supplies it");
const show = (list: Row[], a: string): void => {
  for (const r of list.slice(0, 10)) console.log(`   ${names.get(r.s) ?? r.s}  [${r.i || "C"}]  ${side(r, a)}`);
};

console.log(`artifact ${v}, ${rows.length} rows\n`);

// 1. Cards: draws cards, +1/+1 Counters, fits in green.
const q1 = rows.filter((r) => r.e.includes("draw-card") && r.t.includes("counters") && fits(r.i, "G"));
console.log(`Q1  cards  does=draws cards  strategy=${ARCHETYPE_LABELS.counters}  fits within G: ${q1.length}`);
show(q1, "counters");
console.log(`   of which ask for counters: ${q1.filter((r) => r.d.includes("counters")).length}`);

// 2. Commanders: supports +1/+1 Counters, identity exactly Bant.
const bant = identityKeyOf(["W", "U", "G"]);
const q2 = rows.filter((r) => r.c === 1 && r.t.includes("counters") && r.i === bant);
const ordered = [...q2].sort((a, b) =>
  Number(b.d.includes("counters")) - Number(a.d.includes("counters"))
  || (names.get(a.s) ?? a.s).localeCompare(names.get(b.s) ?? b.s));
console.log(`\nQ2  commanders  supports=${ARCHETYPE_LABELS.counters}  identity=${bant}: ${q2.length}`);
show(ordered, "counters");
