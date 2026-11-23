/** Writes packages/tagger/src/derive/energy.fixtures.json (#1323): for each named energy card the card document fields
 *  derive reads and the clause records its derive actually used (the grammar's own, else the stored answer),
 *  so the tagger test derives from REAL input and needs no Mongo. Run from the repo root:
 *  `npx tsx research/energy/dump-energy-fixtures.mts` (sandbox off, env sourced). */
import { writeFileSync } from "node:fs";
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const g = await import(`${R}/tagger/src/grammar/clause-record.ts`);
const dw = await import(`${R}/tagger/src/derive-worker.ts`);
const store = await data.connect(data.loadConfig());
const NAMES = ["Roil Cartographer", "Peema Trailblazer", "Scurry of Gremlins", "Blaster Hulk", "Aether Hub", "Conversion Apparatus", "HELIOS One", "Brotherhood Scribe",
  "Wrath of the Skies", "Solar Transformer", "Deadlock Trap", "Aetherworks Marvel", "Harnessed Lightning", "Decoction Module", "Aethertide Whale", "Guide of Souls", "Territorial Gorger"];
const out: Record<string, unknown> = {};
for (const n of NAMES) {
  const card: any = await store.cards.findOne({ name: n } as never) ?? await store.cards.findOne({ name: new RegExp("^" + n + " //") } as never);
  if (!card) { console.log("MISSING", n); continue; }
  const doc: any = await store.db.collection("cardClauses").findOne({ oracleId: card._id });
  // The same choice `derive-worker.deriveRow` makes: the grammar's records when it switched, else the stored answer.
  const fromGrammar = doc ? dw.deriveRow({ doc, source: card, isToken: false }).fromGrammar : g.grammarClauseRecords(card).complete;
  const clauses = fromGrammar ? g.grammarClauseRecords(card).records : doc?.canonical;
  if (!clauses) { console.log("NO CLAUSES", n); continue; }
  const keep = ["_id", "name", "typeLine", "oracleText", "keywords", "colors", "colorIdentity", "manaValue", "power", "toughness", "layout", "manaCost", "producedMana", "allParts", "loyalty"];
  out[card.name] = {
    card: { ...Object.fromEntries(keep.filter((k) => card[k] !== undefined).map((k) => [k, card[k]])),
      ...(card.faces ? { faces: card.faces.map((f: any) => ({ name: f.name, typeLine: f.typeLine, manaCost: f.manaCost, loyalty: f.loyalty })) } : {}) },
    clauses, source: fromGrammar ? "grammar" : "model",
  };
}
writeFileSync("packages/tagger/src/derive/energy.fixtures.json", JSON.stringify(out, null, 1) + "\n");
console.log(Object.keys(out).length, "cards");
await store.close();
