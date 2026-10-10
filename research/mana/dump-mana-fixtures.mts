/** Writes packages/tagger/src/derive/mana-lines.fixtures.json: for each named card the card document fields
 *  derive reads and the clause records its derive actually used (the grammar's own, else the stored answer),
 *  so the tagger test derives from REAL input and needs no Mongo. Run from the repo root:
 *  `npx tsx research/mana/dump-mana-fixtures.mts` (sandbox off, env sourced). */
import { writeFileSync } from "node:fs";
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const g = await import(`${R}/tagger/src/grammar/clause-record.ts`);
const dw = await import(`${R}/tagger/src/derive-worker.ts`);
const store = await data.connect(data.loadConfig());
const NAMES = ["Sol Ring", "Arcane Signet", "Cascade Bluffs", "Cascading Cataracts", "Smokebraider", "Omen Hawker", "Phyrexian Altar",
  "Priest of Forgotten Gods", "Birgi, God of Storytelling", "Utopia Sprawl", "Wild Growth", "Exotic Orchard", "Tainted Peak", "Cavern of Souls",
  "Ancient Ziggurat", "Dark Ritual", "Mox Tantalite", "Cryptic Trilobite", "Treasure Map", "Pitiless Plunderer", "Cultivate", "Chromatic Lantern",
  "Chromatic Orrery", "Lotus Petal", "Prismatic Omen", "Evolving Wilds", "Lotus Bloom", "Farseek", "Urborg, Tomb of Yawgmoth", "Llanowar Elves",
  "Wall of Roots", "Aether Hub", "Expand the Sphere", "Path to the Festival", "Kodama's Reach", "Contamination"];
const out: Record<string, unknown> = {};
for (const n of NAMES) {
  const card: any = await store.cards.findOne({ name: n } as never) ?? await store.cards.findOne({ name: new RegExp("^" + n + " //") } as never);
  if (!card) { console.log("MISSING", n); continue; }
  const doc: any = await store.db.collection("cardClauses").findOne({ oracleId: card._id });
  // The same choice `derive-worker.deriveRow` makes: the grammar's records when it switched, else the stored answer.
  const fromGrammar = doc ? dw.deriveRow({ doc, source: card, isToken: false }).fromGrammar : g.grammarClauseRecords(card).complete;
  const clauses = fromGrammar ? g.grammarClauseRecords(card).records : doc?.canonical;
  if (!clauses) { console.log("NO CLAUSES", n); continue; }
  const keep = ["_id", "name", "typeLine", "oracleText", "keywords", "colors", "colorIdentity", "manaValue", "power", "toughness", "layout", "manaCost", "producedMana", "allParts"];
  out[card.name] = {
    card: { ...Object.fromEntries(keep.filter((k) => card[k] !== undefined).map((k) => [k, card[k]])),
      ...(card.faces ? { faces: card.faces.map((f: any) => ({ name: f.name, typeLine: f.typeLine, manaCost: f.manaCost })) } : {}) },
    clauses, source: fromGrammar ? "grammar" : "model",
  };
}
writeFileSync("packages/tagger/src/derive/mana-lines.fixtures.json", JSON.stringify(out, null, 1) + "\n");
console.log(Object.keys(out).length, "cards");
await store.close();
