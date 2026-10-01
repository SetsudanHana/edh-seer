/** FREE. The trigger census for the card grammar (#896, task 5): every triggered clause's PRINTED
 *  preamble ("Whenever a creature you control dies") beside the trigger the clause store holds for it
 *  ({ event, subject, control }), with the number of cards, written to the tracked fixture
 *  `packages/tagger/triggers.jsonl`. `packages/instruments/src/trigger-diff.ts` runs a candidate
 *  trigger grammar against the stored triggers over it.
 *
 *  The preamble is the clause's own printed text up to the comma that ends the trigger condition,
 *  the card's name written "~" (`selfAsTilde`, the same shape the filter grammar was measured on). An
 *  intervening "if" (CR 603.4) is carried as its own field, read by `interveningIfOf`. A clause whose
 *  printed text opens with no trigger word is counted and left out: the model gave it a trigger the
 *  text does not print, which is derive's phantom-trigger guard's business, not the grammar's.
 *
 *  One line per distinct (preamble, condition, event, subject, control), sorted by cards descending
 *  then by the line itself, so a re-run is byte-identical and a diff shows only what moved.
 *
 *  Usage: npx tsx packages/tagger/src/bin/extract-triggers.ts */
import { writeFileSync } from "node:fs";
import { connect, loadConfig } from "@edh-seer/data";
import { CLAUSES_COLLECTION, type CardClausesDoc } from "../clause-store.js";
import { clauseTexts } from "../derive-input.js";
import { interveningIfOf } from "../derive/intervening-if.js";
import { selfAsTilde } from "../grammar/self-as-tilde.js";

const TRIGGERS_PATH = "packages/tagger/triggers.jsonl";
/** The printed trigger condition: a trigger word, then everything up to the first comma. */
const PREAMBLE = /^\s*((?:whenever|when|at the beginning of|at end of)\b[^,]*),/i;

const store = await connect(loadConfig());
const rows = new Map<string, Set<string>>();
let triggered = 0, unprinted = 0;
const docs = store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION).find({ isToken: { $ne: true } } as never, { projection: { oracleId: 1, name: 1, canonical: 1 } });
for await (const d of docs) {
  const card = await store.cards.findOne({ _id: d.oracleId } as never);
  if (!card) continue;
  const texts = clauseTexts(card as never);
  for (const c of d.canonical ?? []) {
    if (!c.trigger) continue;
    triggered++;
    const text = texts[c.id] ?? "";
    const m = PREAMBLE.exec(text);
    if (!m) { unprinted++; continue; }
    const row = JSON.stringify({
      preamble: selfAsTilde(m[1]!.trim(), d.name),
      condition: interveningIfOf(text),
      event: c.trigger.event ?? null,
      subject: selfAsTilde((c.trigger.subject ?? "").trim(), d.name),
      control: c.trigger.control ?? null,
    });
    (rows.get(row) ?? rows.set(row, new Set()).get(row)!).add(d.oracleId);
  }
}
await store.close();

const lines = [...rows].map(([row, ids]) => ({ row, cards: ids.size }))
  .sort((a, b) => b.cards - a.cards || (a.row < b.row ? -1 : a.row > b.row ? 1 : 0))
  .map(({ row, cards }) => `${row.slice(0, -1)},"cards":${cards}}`);
writeFileSync(TRIGGERS_PATH, lines.join("\n") + "\n");
console.log(`triggered clauses ${triggered}; printed no trigger word ${unprinted}; ${lines.length} distinct rows -> ${TRIGGERS_PATH}`);
