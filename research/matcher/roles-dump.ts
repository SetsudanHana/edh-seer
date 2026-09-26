/** EVERY ROLE AND ANSWER-CLASS MEMBERSHIP ON THE 71 DECKS, one per line, so a rules change is diffed
 *  by card rather than by total. Prints tab-separated `deck  role|answer  category  card`.
 *
 *    npx tsx research/matcher/roles-dump.ts > before.tsv   # then change, dump again
 *    diff <(sort before.tsv) <(sort after.tsv) */
import { readFileSync, readdirSync } from "node:fs";
import { connect, loadConfig, mongoLookup, parseDecklistSections, resolveNames } from "../../packages/data/src/index.js";
import { createTagsLookup } from "../../packages/tagger/src/index.js";
import { buildDeckCards, detectAnswerClasses, detectBuildCategories } from "../../packages/matcher/src/index.js";
import { CALIBRATION_DECKS } from "@edh-seer/data";
const DIR = process.argv[2] ?? CALIBRATION_DECKS;
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = createTagsLookup(store.db, "derived");
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort()) {
  const s = parseDecklistSections(readFileSync(`${DIR}/${file}`, "utf8"));
  const { cards } = await resolveNames([...s.commanders, ...s.deck], lookup);
  const dc = await buildDeckCards(cards, lookup, tags);
  const deck = file.replace(/\.txt$/, "");
  for (const [cat, set] of detectBuildCategories(dc)) for (const n of set) console.log([deck, "role", cat, n].join("\t"));
  for (const [cls, m] of detectAnswerClasses(dc)) for (const n of m.cards) console.log([deck, "answer", cls, n].join("\t"));
}
await store.close();
