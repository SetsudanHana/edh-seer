/** Writes packages/matcher/src/fixtures/mana-colour-sources.json (#1169 task 2a): REAL Card documents and the mana keys of their
 *  REAL derived tags (manaLines, staticFixer, landFetch, isOneShot, suspendOnly) for the named cards, and the whole Gisa deck, so the
 *  matcher's colour-source tests run on production derivation with no Mongo. Run from the repo root (sandbox off, env sourced):
 *  `npx tsx research/mana/dump-colour-fixtures.mts`. */
import { readFileSync, writeFileSync } from "node:fs";
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const tagger = await import(`${R}/tagger/src/index.ts`);
const m = await import(`${R}/matcher/src/index.ts`);
const { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames, DECKS_DIR } = data;
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = tagger.createTagsLookup(store.db, "derived");
const KEYS = ["manaLines", "staticFixer", "landFetch", "isOneShot", "suspendOnly"] as const;
const slim = (t: any) => (t ? Object.fromEntries(KEYS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]])) : null);
const dump = async (names: string[]) => {
  const { cards, missing } = await resolveNames(names, lookup);
  if (missing.length) console.log("MISSING", missing);
  const dcs = await m.buildDeckCards(cards, lookup, tags);
  return dcs.map((dc: any) => ({ card: dc.card, tags: slim(dc.tags) }));
};
const NAMES = ["Pitiless Plunderer", "Phyrexian Altar", "Priest of Forgotten Gods", "Birgi, God of Storytelling", "Smokebraider", "Omen Hawker",
  "Cryptic Trilobite", "Utopia Sprawl", "Wild Growth", "Honored Hierarch", "Sol Ring", "Arcane Signet", "Exotic Orchard", "Tainted Peak",
  "Cascade Bluffs", "Cascading Cataracts", "Cultivate", "Chromatic Lantern", "Urborg, Tomb of Yawgmoth", "Yavimaya, Cradle of Growth",
  "Plains", "Treasure Map", "Cavern of Souls", "Polluted Delta", "Myriad Landscape", "Wood Elves", "Lotus Petal", "Dark Ritual", "Mox Tantalite",
  "Command Tower", "Flagstones of Trokair", "Reflecting Pool", "Cabal Coffers", "Chromatic Orrery", "Overgrown Tomb", "Mystic Sanctuary", "Blightstep Pathway",
  "Plaza of Heroes", "The Grey Havens", "Mox Amber", "Chrome Mox", "Faeburrow Elder", "Guild Globe", "Ether", "Meteor Crater", "Aether Hub",
  "Servant of the Conduit", "Bog Witch", "Cryptex", "Molt Tender", "Thornvault Forager", "Fertile Ground"];
const out: any = { cards: await dump(NAMES) };
const s = parseDecklistSections(readFileSync(`${DECKS_DIR}/gisa.txt`, "utf8"));
out.gisa = { commanders: s.commanders.map((c: string) => normalizeName(c)), deck: await dump([...s.commanders, ...s.deck]) };
writeFileSync("packages/matcher/src/fixtures/mana-colour-sources.json", JSON.stringify(out) + "\n");
console.log(out.cards.length, "named,", out.gisa.deck.length, "gisa");
await store.close();
