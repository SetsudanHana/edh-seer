import { readFileSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames } from "@mtg/data";
import { ComboIndex } from "@mtg/engine";
import { createTagsLookup } from "@mtg/tagger";
import { analyzeDeckStructured, buildDeckCards, type CardTagsLookup } from "../index.js";
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags: CardTagsLookup = createTagsLookup(store.db, "derived-first");
const file = process.argv[2], want = process.argv[3];
const sections = parseDecklistSections(readFileSync(file, "utf8"));
const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
const cmd = new Set(sections.commanders.map(normalizeName));
const deckCards = await buildDeckCards(cards, lookup, tags);
const report = analyzeDeckStructured(deckCards, cards.filter((c) => cmd.has(normalizeName(c.name))).map((c) => c.name),
  undefined, undefined, new ComboIndex(combos));
console.log("commanderNames:", JSON.stringify(cards.filter((c) => cmd.has(normalizeName(c.name))).map((c) => c.name)));
const hits = report.edges.filter((e) => e.a.includes(want) || e.b.includes(want));
console.log(`edges touching "${want}": ${hits.length}`);
for (const e of hits.slice(0, 6)) {
  console.log(`  ${e.a} <-> ${e.b}  (score ${e.score})`);
  for (const r of e.reasons.slice(0, 3)) console.log(`      ${r.text}`);
}
await store.close();
process.exit(0);
