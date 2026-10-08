/** ONE-SHOT (#972 census, owner 2026-10-08: "measure first, then decide"). Over the 71 calibration
 *  decks: which reason-tag FAMILIES never reach the deck axis, how many reasons and edges each
 *  carries, and how many off-plan edges each family appears on. "Off-plan" is read through
 *  `axisWeightOf`, so after #972 step 1 the inherited families count as on-plan. Also prints what
 *  the "inherit from parent theme" candidate map would give.
 *
 *    npx tsx research/matcher/relation-axis-census.ts */
import { readdirSync, readFileSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames, CALIBRATION_DECKS } from "../../packages/data/src/index.js";
import { ComboIndex } from "../../packages/engine/src/index.js";
import { createTagsLookup } from "../../packages/tagger/src/index.js";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags } from "../../packages/matcher/src/index.js";
import { axisWeightOf } from "../../packages/matcher/src/axis.js";

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = createTagsLookup(store.db);
const tokenTags = await loadTokenTags(store.db);

const famOf = (tag: string): string => tag.split(":")[0]!;
/** Candidate parent themes for the "inherit" design: relation family -> card theme tags whose axis
 *  weight it would borrow, same subject. Printed for the owner, not shipped. */
const PARENTS: Record<string, string[]> = {
  fodder: ["sacrifice", "dies"],
  scales: ["enters", "create-token"],
  cheat: ["enters"],
  creates: ["create-token", "enters"],
};

type Fam = { reasons: number; onAxis: number; decks: Set<string>; edgesOnlyVia: number; inheritOn: number };
const fams = new Map<string, Fam>();
const fam = (f: string): Fam => fams.get(f) ?? (fams.set(f, { reasons: 0, onAxis: 0, decks: new Set(), edgesOnlyVia: 0, inheritOn: 0 }), fams.get(f)!);
let totalEdges = 0, offPlanEdges = 0;
const perDeck: string[] = [];

for (const file of readdirSync(CALIBRATION_DECKS).filter((f) => f.endsWith(".txt")).sort()) {
  const sections = parseDecklistSections(readFileSync(`${CALIBRATION_DECKS}/${file}`, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmd = new Set(sections.commanders.map(normalizeName));
  const commanders = cards.filter((c) => cmd.has(normalizeName(c.name))).map((c) => c.name);
  const report = analyzeDeckStructured(await buildDeckCards(cards, lookup, tags), commanders, undefined, undefined, new ComboIndex(combos), undefined, tokenTags);
  const axis = new Map((report.axis ?? []).map((a: { tag: string; weight: number }) => [a.tag, a.weight]));
  const deck = file.replace(/\.txt$/, "");
  let dEdges = 0, dOff = 0;
  for (const edge of report.edges as { reasons: { tag: string }[] }[]) {
    dEdges++;
    const onW = Math.max(0, ...edge.reasons.map((r) => axisWeightOf(r.tag, axis)));
    for (const r of edge.reasons) {
      const f = fam(famOf(r.tag));
      f.reasons++; f.decks.add(deck);
      if ((axis.get(r.tag) ?? 0) > 0) f.onAxis++;
      const parents = PARENTS[famOf(r.tag)];
      if (parents) {
        const subj = r.tag.slice(r.tag.indexOf(":") + 1);
        if (Math.max(0, ...parents.map((p) => axis.get(`${p}:${subj}`) ?? 0)) > 0) f.inheritOn++;
      }
    }
    if (onW === 0) {
      dOff++;
      // Every family on an off-plan edge; the families that never reach any axis are read off the table.
      const relFams = [...new Set(edge.reasons.map((r) => famOf(r.tag)))];
      for (const x of relFams) fam(x).edgesOnlyVia++;
    }
  }
  totalEdges += dEdges; offPlanEdges += dOff;
  perDeck.push(`${deck.padEnd(40)} edges ${String(dEdges).padStart(5)}  off-plan ${String(dOff).padStart(5)}  `);
}
await store.close();

console.log(`71-deck totals: edges ${totalEdges}, off-plan (axis weight 0) ${offPlanEdges} (${(100 * offPlanEdges / totalEdges).toFixed(1)}%), edges counted per family below (an edge can carry several)\n`);
console.log("family                reasons  on-axis%  decks  off-plan-edges-with-it  inherit-would-be-on%");
for (const [name, f] of [...fams].sort((a, b) => b[1].reasons - a[1].reasons)) {
  const inherit = PARENTS[name] ? `${(100 * f.inheritOn / f.reasons).toFixed(1)}%` : "-";
  console.log(`${name.padEnd(20)} ${String(f.reasons).padStart(8)}  ${(100 * f.onAxis / f.reasons).toFixed(1).padStart(7)}%  ${String(f.decks.size).padStart(5)}  ${String(f.edgesOnlyVia).padStart(22)}  ${inherit.padStart(20)}`);
}
console.log("\nper deck:");
for (const l of perDeck) console.log(l);
