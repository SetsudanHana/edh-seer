/** EVERY REASON ON THE 71 DECKS, ONE PER LINE, so two runs can be diffed by content rather than
 *  compared by total. "Diff reasons, not totals" (DERIVE 150, 2026-09-16): a total that moves by
 *  +200 says nothing about WHICH pairs joined, and a total that holds can hide a loss behind a gain.
 *  Prints tab-separated `deck  producer  consumer  tag  text`; sort and `diff` two captures.
 *
 *    npx tsx research/matcher/reason-dump.ts > before.tsv   # then change, re-derive, dump again
 *    diff <(sort before.tsv) <(sort after.tsv) */
import { readFileSync, readdirSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames } from "../../packages/data/src/index.js";
import { createTagsLookup } from "../../packages/tagger/src/index.js";
import { ComboIndex } from "../../packages/engine/src/index.js";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags, type CardTagsLookup } from "../../packages/matcher/src/index.js";

const DIR = process.argv[2] ?? "packages/cli/decks/calibration";
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags: CardTagsLookup = createTagsLookup(store.db, "derived");
const tokenTags = await loadTokenTags(store.db);

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort()) {
  const sections = parseDecklistSections(readFileSync(`${DIR}/${file}`, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmdNorm = new Set(sections.commanders.map(normalizeName));
  const commanderNames = cards.filter((c) => cmdNorm.has(normalizeName(c.name))).map((c) => c.name);
  const deckCards = await buildDeckCards(cards, lookup, tags);
  const report = analyzeDeckStructured(deckCards, commanderNames, undefined, undefined, new ComboIndex(combos), undefined, tokenTags);
  const deck = file.replace(/\.txt$/, "");
  for (const e of report.edges) for (const r of e.reasons) {
    console.log([deck, r.producer, r.consumer, r.tag, r.text].join("\t"));
  }
}
process.exit(0);
