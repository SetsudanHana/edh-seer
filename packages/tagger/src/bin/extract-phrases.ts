/** FREE. The phrase census for the card grammar (#896, task 1): every distinct trigger subject and
 *  action object in the stored clauses, with the number of cards that use it, written to the tracked
 *  fixture `packages/tagger/phrases.jsonl`. `packages/instruments/src/phrase-diff.ts` runs any parser
 *  against `parseSubject` over it.
 *
 *  THE CARD'S OWN NAME IS WRITTEN "~" (Scryfall's convention): "Meathook Massacre II" as a trigger
 *  subject is a self-reference, not a phrase of the filter language, and 2,000 names would each be a
 *  singleton. Matched case-sensitively. Legendary short names ("Gandalf" for "Gandalf, Shadow's Foe") and each face's name count.
 *
 *  One line per phrase, sorted by kind, then cards descending, then phrase, so a re-run is
 *  byte-identical and a diff shows only what moved.
 *
 *  Usage: npx tsx packages/tagger/src/bin/extract-phrases.ts */
import { writeFileSync } from "node:fs";
import { connect, isStickerCard, loadConfig } from "@edh-seer/data";
import { CLAUSES_COLLECTION, type CardClausesDoc } from "../clause-store.js";
import { selfAsTilde } from "../grammar/self-as-tilde.js";

const PHRASES_PATH = "packages/tagger/phrases.jsonl";

const store = await connect(loadConfig());
const seen = { subject: new Map<string, Set<string>>(), object: new Map<string, Set<string>>() };
const add = (kind: keyof typeof seen, phrase: string | undefined | null, name: string, id: string) => {
  const p = selfAsTilde((phrase ?? "").trim(), name);
  if (!p) return;
  (seen[kind].get(p) ?? seen[kind].set(p, new Set()).get(p)!).add(id);
};
const docs = store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION).find({ isToken: { $ne: true } } as never, { projection: { oracleId: 1, name: 1, canonical: 1 } });
// Sticker cards are outside the engine (owner 2026-10-02): not in the census either.
const stickers = new Set((await store.cards.find({ oracleText: /sticker/i } as never, { projection: { _id: 1, oracleText: 1, faces: 1 } }).toArray())
  .filter((c) => isStickerCard(c as never)).map((c) => c._id));
for await (const d of docs) {
  if (stickers.has(d.oracleId)) continue;
  for (const c of d.canonical ?? []) {
    add("subject", c.trigger?.subject, d.name, d.oracleId);
    for (const a of c.actions ?? []) add("object", a.object, d.name, d.oracleId);
  }
}
await store.close();

const lines: string[] = [];
for (const kind of ["subject", "object"] as const) {
  const rows = [...seen[kind]].map(([phrase, ids]) => ({ kind, phrase, cards: ids.size }))
    .sort((a, b) => b.cards - a.cards || (a.phrase < b.phrase ? -1 : a.phrase > b.phrase ? 1 : 0));
  for (const r of rows) lines.push(JSON.stringify(r));
  console.log(`${kind}: ${rows.length} distinct, ${rows.reduce((n, r) => n + r.cards, 0)} card-occurrences`);
}
writeFileSync(PHRASES_PATH, lines.join("\n") + "\n");
console.log(`wrote ${PHRASES_PATH}`);
