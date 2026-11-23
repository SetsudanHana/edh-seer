/** Writes packages/tagger/src/derive/attraction.fixtures.json (#1325): for each named "open an Attraction" card (and two real investigators) the card document fields
 *  derive reads and the clause records its derive actually used (the grammar's own, else the stored answer),
 *  so the tagger test derives from REAL input and needs no Mongo. Run from the repo root:
 *  `npx tsx research/attraction/dump-attraction-fixtures.mts` (sandbox off, env sourced). */
import { writeFileSync } from "node:fs";
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const g = await import(`${R}/tagger/src/grammar/clause-record.ts`);
const dw = await import(`${R}/tagger/src/derive-worker.ts`);
const store = await data.connect(data.loadConfig());
const NAMES = ["Complaints Clerk", "Discourtesy Clerk", "Pick-a-Beeble", "Myra the Magnificent", "Soul Swindler", "Coming Attraction", "Seasoned Buttoneer", "Rad Rascal", "Squirrel Squatters",
  "\"Lifetime\" Pass Holder", "Ride Guide", "Spinnerette, Arachnobat", "Quick Fixer", "Petting Zookeeper", "Deadbeat Attendant", "The Most Dangerous Gamer", "Dee Kay, Finder of the Lost", "Monitor Monitor",
  "Draconian Gate-Bot", "Tireless Tracker", "Forensic Gadgeteer"];
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
writeFileSync("packages/tagger/src/derive/attraction.fixtures.json", JSON.stringify(out, null, 1) + "\n");
console.log(Object.keys(out).length, "cards");
await store.close();
