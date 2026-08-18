/** THE RATINGS INSTRUMENT. Free: no API, no writes, no spend.
 *
 *  Every other gate in this repo watches a different axis -- `panel-score.ts` measures CLAIMS,
 *  `population-compare.ts` measures edges and reasons, `build-population.ts` measures CATEGORY
 *  membership. None of them reads a per-card rating, and two shipped changes said so in their own
 *  commit messages rather than measuring it: `322d129` (one node per card, not per copy) and the
 *  tokens-as-nodes mediation, both of which changed per-card partner counts by construction.
 *  This is the missing reader.
 *
 *  Three modes, all over the 71 calibration decks:
 *
 *    tsx src/bin/ratings-compare.ts --save before.json     snapshot the current tree
 *    tsx src/bin/ratings-compare.ts --against before.json  compare the current tree to a snapshot
 *    tsx src/bin/ratings-compare.ts --tokens-off           token NODES off vs on, one process
 *
 *  The first two are the general before/after: snapshot, change code, compare -- the only mode that
 *  can measure a code change, since the change has to exist in the tree to be seen.
 *
 *  READ THIS BEFORE QUOTING `--tokens-off`. It omits the optional `tokenTags` argument, which
 *  removes the token NODES and nothing else. It is NOT the pre-tokens engine: the mediation rule in
 *  `edges.ts` (`e.subject.token === true && ... && !p.isToken && !c.isToken`) is keyed on the
 *  producer's SUBJECT, not on whether a token node exists, so the direct maker->payoff shortcut stays
 *  suppressed in both arms. Measured 2026-08-18: raw scores and partner counts move by exactly ZERO
 *  between the arms, which is the code path saying so -- the directional pass that produces
 *  `score`/`partnerCount`/`authority` runs over `unique` (real cards only) and never reads a token
 *  edge. What DOES move is the axis pass, which reads every edge including token ones, so a token
 *  edge can put a card on-axis and flip its `doubleDuty` 1.15x premium. To measure the mediation
 *  itself, snapshot a tree with the suppression disabled and `--against` it.
 *
 *  With no arguments it prints the current aggregate and nothing else, which is how you check the
 *  instrument runs before trusting a delta from it. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import {
  connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames,
} from "@mtg/data";
import { ComboIndex } from "@mtg/engine";
import { createTagsLookup } from "@mtg/tagger";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags } from "../index.js";
import { diffRatings, formatRatingsDiff, type DeckRatings, type Snapshot } from "../ratings-diff.js";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DIR = args.find((a) => !a.startsWith("--") && a.endsWith("calibration")) ?? "packages/cli/decks/calibration";
const SAVE = flag("--save");
const AGAINST = flag("--against");
const TOKENS_OFF = args.includes("--tokens-off");

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
// The SAME lookup the product ships (TAGS_SOURCE), not a hardcoded collection -- `build-population.ts`
// spent months reading a population nothing shipped by hardcoding `cardTags`.
const tags = createTagsLookup(store.db);
const tokenTags = await loadTokenTags(store.db);

/** One deck, rated. `withTokens: false` is the counterfactual: `analyzeDeckStructured` takes the
 *  token lookup as an optional argument, so omitting it is exactly the pre-tokens code path. */
async function rate(file: string, withTokens: boolean): Promise<DeckRatings> {
  const sections = parseDecklistSections(readFileSync(`${DIR}/${file}`, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmdNorm = new Set(sections.commanders.map(normalizeName));
  const commanderNames = cards.filter((c) => cmdNorm.has(normalizeName(c.name))).map((c) => c.name);
  const deckCards = await buildDeckCards(cards, lookup, tags);
  const report = analyzeDeckStructured(
    deckCards, commanderNames, undefined, undefined, new ComboIndex(combos), undefined,
    withTokens ? tokenTags : undefined,
  );
  const out: DeckRatings = {
    deck: file.replace(/\.txt$/, ""),
    // `breadth` is the report's `positiveCoherence` -- the SAME number `synergyOverall` blends with
    // `anchoring`, named as the UI names it.
    breadth: report.positiveCoherence ?? 0,
    anchoring: report.anchoring ?? 0,
    synergyOverall: report.synergyOverall ?? 0,
    cards: {},
  };
  for (const c of report.cards) {
    // A TOKEN NODE IS NOT A CARD SLOT and never appears here: `ratedCards` is built off `cards`,
    // which `analyzeDeckStructured` keeps on the real deck. So a token-on/off diff shows what the
    // tokens did to the REAL cards' ratings, which is the question -- not a longer card list.
    out.cards[c.name] = {
      rating: c.synergyRating ?? 0,
      score: c.score,
      partners: c.partnerCount,
      authority: c.authority ?? 0,
    };
  }
  return out;
}

async function snapshot(withTokens: boolean): Promise<Snapshot> {
  const rows: Snapshot = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort()) {
    rows.push(await rate(file, withTokens));
    process.stdout.write(".");
  }
  process.stdout.write("\n");
  return rows;
}

const summarize = (s: Snapshot): string => {
  const cards = s.flatMap((d) => Object.values(d.cards));
  const rated = cards.filter((c) => c.rating > 0);
  const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  return [
    `  decks ${s.length}, cards ${cards.length}, rated > 0 ${rated.length}`,
    `  mean rating ${mean(cards.map((c) => c.rating)).toFixed(3)} (over rated cards ${mean(rated.map((c) => c.rating)).toFixed(3)})`,
    `  mean partners ${mean(cards.map((c) => c.partners)).toFixed(2)}`,
    `  mean deck facets: breadth ${mean(s.map((d) => d.breadth)).toFixed(2)}, anchoring ${mean(s.map((d) => d.anchoring)).toFixed(2)}, overall ${mean(s.map((d) => d.synergyOverall)).toFixed(2)}`,
  ].join("\n");
};

if (TOKENS_OFF) {
  console.log("tokens OFF:");
  const off = await snapshot(false);
  console.log("tokens ON:");
  const on = await snapshot(true);
  console.log(`\ntokens OFF\n${summarize(off)}`);
  console.log(`\ntokens ON\n${summarize(on)}`);
  console.log(formatRatingsDiff(diffRatings(off, on), "tokens-off", "tokens-on"));
} else {
  const current = await snapshot(true);
  console.log(`\ncurrent\n${summarize(current)}`);
  if (SAVE) {
    writeFileSync(SAVE, JSON.stringify(current, null, 1));
    console.log(`\nsaved ${current.length} decks to ${SAVE}`);
  }
  if (AGAINST) {
    const before = JSON.parse(readFileSync(AGAINST, "utf8")) as Snapshot;
    console.log(formatRatingsDiff(diffRatings(before, current), AGAINST, "current"));
  }
}

await store.close();
