/** Writes packages/matcher/src/fixtures/goldfish-cards.json (#1169 task 2b-1): REAL Card documents and the mana keys of their REAL derived tags
 *  for the named cards the goldfish and land-count tests read, so those tests run on production derivation with no Mongo. Run from the repo root
 *  (sandbox off, env sourced): `npx tsx research/mana/dump-goldfish-fixtures.mts`. */
import { writeFileSync } from "node:fs";
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const tagger = await import(`${R}/tagger/src/index.ts`);
const m = await import(`${R}/matcher/src/index.ts`);
const { connect, loadConfig, mongoLookup, resolveNames } = data;
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = tagger.createTagsLookup(store.db, "derived");
const KEYS = ["manaLines", "staticFixer", "landFetch", "isOneShot", "suspendOnly"] as const;
const slim = (t: any) => (t ? Object.fromEntries(KEYS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]])) : null);
const NAMES = ["Sol Ring", "Llanowar Elves", "Nature's Lore", "Kodama's Reach", "Dark Ritual", "Desperate Ritual", "Seething Song", "Rite of Flame", "Culling the Weak",
  "Cabal Ritual", "Jeska's Will", "High Tide", "Eldrazi Confluence", "Forest", "Temple of the False God", "Urza's Mine", "Urza's Power Plant", "Urza's Tower", "Planar Nexus", "Rakdos Carnarium",
  "Jegantha, the Wellspring", "Prismatic Lens", "Cascade Bluffs", "Sceptre of Eternal Glory", "Wild Growth", "Utopia Sprawl", "Overgrowth", "Fertile Ground",
  "Lotus Cobra", "Omnath, Locus of the Void", "Birgi, God of Storytelling", "Burning-Tree Emissary", "Pitiless Plunderer", "Chromatic Lantern", "Enduring Vitality",
  "Muerra, Trash Tactician", "Abstract Paintmage", "Eladamri's Vineyard", "Coalition Relic", "Forsaken Monument", "Leyline of Abundance", "Fabled Passage",
  "Evolving Wilds", "Polluted Delta", "Scalding Tarn", "Myriad Landscape", "Wayfarer's Bauble", "Mox Tantalite", "Cryptic Trilobite", "Mana Crypt", "Gaea's Cradle",
  "Cavern of Souls", "Tainted Peak", "Command Tower", "Thran Dynamo", "Mana Flare", "Wood Elves", "Sakura-Tribe Elder", "Chrome Mox", "Lotus Petal",
  "Springleaf Drum", "Wall of Roots", "Fellwar Stone", "Troyan, Gutsy Explorer", "Ashling, Rekindled", "Mox Diamond", "Mana Vault", "Chaos Moon",
  "Seething Landscape", "Mox Jasper", "Howlsquad Heavy", "Studious First-Year", "Charitable Levy", "Crypt Ghast", "Chandra, Torch of Defiance", "Muraganda Raceway", "Relic of Sauron", "Ancient Ziggurat", "Simian Spirit Guide", "Domri, Anarch of Bolas", "Goldspan Dragon", "Hulking Raptor", "Black Market", "Thran Turbine", "Mana Drain", "Priest of Gix", "Phyrexian Altar", "Treasure Map", "Silundi Vision", "Hagra Mauling", "Chandra, Flameshaper", "Chandra, Legacy of Fire", "Chandra, Novice Pyromancer", "Chandra, Heart of Fire", "Ugin, Eye of the Storms", "Koth of the Hammer", "Jaya Ballard", "Princess Yue", "Imprisoned in the Moon", "Island", "Swamp", "Mountain", "Plains"];
const { cards, missing } = await resolveNames(NAMES, lookup);
if (missing.length) console.log("MISSING", missing);
const dcs = await m.buildDeckCards(cards, lookup, tags);
const out = dcs.map((dc: any) => ({ card: dc.card, tags: slim(dc.tags) }));
writeFileSync("packages/matcher/src/fixtures/goldfish-cards.json", JSON.stringify(out) + "\n");
console.log(out.length, "cards");
await store.close();
