// LOCAL RESEARCH ONLY (#1318): census, per CLAUSE, of every `gains-control` emit in cardTagsDerived against the PRINTED text of the clause that emitted it.
// FREE: reads Mongo (cards + cardTagsDerived), writes nothing. Lists every emit whose clause prints no control change (`printsControlChange`, derive/emits.ts).
// Run from the repo root after `set -a && source packages/tagger/.env && set +a`: npx tsx research/tagger/gains-control-census.ts
import { connect, loadConfig } from "@edh-seer/data";
import { clauseTexts } from "../../packages/tagger/src/derive-input.js";
import { printsControlChange } from "../../packages/tagger/src/derive/emits.js";

const store = await connect(loadConfig());
type Row = { name: string; oracleId: string; abilities?: { clause?: number; emits?: { verb: string }[] }[]; unclaimed?: unknown[] };
const derived = store.db.collection<Row>("cardTagsDerived");
let clausesYes = 0, clausesNo = 0, noText = 0, unclaimed = 0;
const cardsAll = new Set<string>(), cardsNo = new Set<string>();
const seen = new Set<string>(), no: string[] = [];
for await (const row of derived.find({ "abilities.emits.verb": "gains-control" })) {
  const card = await store.cards.findOne({ _id: row.oracleId } as never, { projection: { name: 1, oracleText: 1, keywords: 1, typeLine: 1 } }) as never as { name?: string; oracleText?: string; keywords?: string[]; typeLine?: string } | null;
  const texts = card ? clauseTexts(card) : {};
  row.name = card?.name ?? row.oracleId;
  for (const ab of row.abilities ?? []) {
    if (!ab.emits?.some((e) => e.verb === "gains-control")) continue;
    const key = `${row.oracleId}#${ab.clause}`;
    if (seen.has(key)) continue; // one ability per clause is the unit
    seen.add(key); cardsAll.add(row.name);
    const text = texts[ab.clause ?? -1];
    if (text === undefined) { noText++; no.push(`${row.name} [clause ${ab.clause}: NO TEXT]`); cardsNo.add(row.name); continue; }
    if (printsControlChange(text)) clausesYes++;
    else { clausesNo++; cardsNo.add(row.name); no.push(`${row.name} [clause ${ab.clause}] ${text}`); }
  }
  unclaimed += (row.unclaimed ?? []).filter((u) => (u as { verb: string }).verb === "gain-control").length;
}
console.log(`gains-control clauses: ${seen.size} on ${cardsAll.size} cards; print a control change ${clausesYes}; do NOT ${clausesNo} (+${noText} with no clause text) on ${cardsNo.size} cards; already-unclaimed gain-control actions ${unclaimed}`);
for (const l of no.sort()) console.log("NOT |", l);
await store.close();
