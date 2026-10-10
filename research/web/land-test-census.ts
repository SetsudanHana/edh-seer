import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CALIBRATION_DECKS } from "../../packages/data/src/deck-paths.js";
import { analyzeDeckStatic } from "../../packages/web/client/src/api.static.js";
import { landCount as shapeLandCount } from "../../packages/web/client/src/lib/deck-shape.js";

/** "IS THIS CARD A LAND", MEASURED (#1167). Per deck, the land count each reader reports: BUILD's
 *  (`report.buildCategories` row "lands", the number the Build dial scores), the DECK MATH row
 *  (`report.deckMath.lands.actual`, the land-count target's own tally) and the DECK SHAPE chart's
 *  (`deck-shape.ts landCount` over the graph nodes). The goldfish's own land count is not exposed on
 *  the report; its land test is the `isLand` slot flag in `manaModel`, so the three here are what
 *  can be read. Prints only decks where the three disagree, then totals (ALL=1 prints every deck; ROLES=1 also dumps each card's roles (ROLE rows) and the cut list (CUT rows), to count gained/lost roles and changed cuts by diff). Run at two commits and diff.
 *
 *    STATIC=https://edhseer.cards/static npx tsx research/web/land-test-census.ts
 */
const STATIC = process.env.STATIC ?? "https://edhseer.cards/static";
const files = [
  ...readdirSync(CALIBRATION_DECKS).filter((f) => f.endsWith(".txt")).sort().map((f) => join(CALIBRATION_DECKS, f)),
  ...["gisa", "first-deck-108", "precon-party-time"].map((n) => `packages/cli/decks/${n}.txt`),
];
let decks = 0, disagree = 0;
const sum = { build: 0, math: 0, shape: 0 };
for (const file of files) {
  const { report, graph } = await analyzeDeckStatic(readFileSync(file, "utf8"), undefined, STATIC);
  const r = report as unknown as { buildCategories?: { category: string; count: number }[]; deckMath?: { lands?: { actual?: number } } };
  const build = r.buildCategories?.find((c) => c.category === "lands")?.count ?? -1;
  const math = r.deckMath?.lands?.actual ?? -1;
  const shape = graph ? shapeLandCount(graph.nodes) : -1;
  if (process.env.ROLES) for (const c of (report as unknown as { cards?: { name: string; roles?: string[] }[] }).cards ?? []) console.log(`ROLE ${file.split("/").pop()} | ${c.name} | ${(c.roles ?? []).join(",")}`);
  if (process.env.ROLES) for (const c of (report as unknown as { cutList?: { name: string }[] }).cutList ?? []) console.log(`CUT ${file.split("/").pop()} | ${c.name}`);
  decks++; sum.build += build; sum.math += math; sum.shape += shape;
  if (process.env.ALL) console.log(`${file.split("/").pop()}: ${build} ${math} ${shape}`);
  if (new Set([build, math, shape]).size > 1) { disagree++; console.log(`${file.split("/").pop()}: build ${build} | deckMath ${math} | shape ${shape}`); }
}
console.log(`${decks} decks: ${disagree} where build/deckMath/shape disagree; summed lands build ${sum.build} deckMath ${sum.math} shape ${sum.shape}`);
