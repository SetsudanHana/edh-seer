/** Threshold lines across the 71 calibration decks. Free -- read-only, no model, no spend.
 *
 *  The regression instrument for docs/superpowers/specs/2026-08-14-threshold-lines-design.md.
 *  Deck loading copies population-compare.ts's shape exactly (readdirSync + parseDecklistSections +
 *  resolveNames + buildDeckCards) -- there is no second calibration-deck loader in this repo.
 *  `detectLines` is pure and reads nothing but the tags already loaded; nothing downstream (the
 *  deck report, buildScore, detectWincons) calls it, which is the acceptance test for this bin.
 *
 *  Usage: tsx src/bin/line-report.ts */
import { readFileSync, readdirSync } from "node:fs";
import { connect, loadConfig, mongoLookup, parseDecklistSections, resolveNames } from "@mtg/data";
import { createTagsLookup } from "@mtg/tagger";
import { buildDeckCards, detectLines, loadHierarchy, type CardTagsLookup } from "../index.js";

const DIR = "packages/cli/decks/calibration";

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags: CardTagsLookup = createTagsLookup(store.db, "derived");
const hierarchy = loadHierarchy();

const tally = {
  lines: 0, decks: 0,
  multiplicative: 0, additive: 0, unknownGrowth: 0,
  noTerminal: 0, assumedBase: 0, unknownGrowthRefusal: 0,
  refusalReasons: {} as Record<string, number>,
};

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort()) {
  const name = file.replace(/\.txt$/, "");
  const sections = parseDecklistSections(readFileSync(`${DIR}/${file}`, "utf8"));
  const { cards } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const deckCards = await buildDeckCards(cards, lookup, tags);

  const { lines, refusals } = detectLines(deckCards, hierarchy);
  for (const [reason, count] of Object.entries(refusals)) {
    tally.refusalReasons[reason] = (tally.refusalReasons[reason] ?? 0) + count;
  }
  if (!lines.length) continue;
  tally.decks++;
  for (const l of lines) {
    tally.lines++;
    if (l.growth === "multiplicative") tally.multiplicative++;
    if (l.growth === "additive") tally.additive++;
    if (l.growth === "unknown") tally.unknownGrowth++;
    if (l.refusals.includes("no-terminal")) tally.noTerminal++;
    if (l.refusals.includes("assumed-base-1")) tally.assumedBase++;
    if (l.refusals.includes("unknown-growth")) tally.unknownGrowthRefusal++;

    const factor = l.factor ? ` x${l.factor}` : "";
    const iters = l.iterations === undefined ? "unknown" : `${l.iterations}`;
    console.log(
      `${name} | ${l.anchor} | ${l.resource.kind}:${l.resource.name} | N=${l.threshold} | ` +
      `${l.growth}${factor} | ${iters} activations | terminal ${l.terminal ?? "(none)"}`,
    );
    const pieceStr = l.pieces.map((p) => {
      const bits: string[] = [p.role];
      if (p.phase) bits.push(`phase:${p.phase}`);
      if (p.unproven) bits.push("unproven");
      return `${p.card} (${bits.join(", ")})`;
    }).join(", ");
    console.log(`        pieces: ${pieceStr}`);
    if (l.refusals.length) console.log(`        refusals: ${l.refusals.join(", ")}`);
  }
}
await store.close();

console.log(`\nlines ${tally.lines} across ${tally.decks} decks`);
console.log(`growth: multiplicative ${tally.multiplicative} · additive ${tally.additive} · unknown ${tally.unknownGrowth}`);
console.log(
  `refusals: no-terminal ${tally.noTerminal} · assumed-base-1 ${tally.assumedBase} · ` +
  `unknown-growth ${tally.unknownGrowthRefusal} · no-resource ${tally.refusalReasons["no-resource"] ?? 0}`,
);
