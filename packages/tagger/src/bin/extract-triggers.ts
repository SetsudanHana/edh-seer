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
import { withoutArticle } from "../derive/self-reference.js";
import { SUBTYPES } from "../derive/subtypes.js";

const TRIGGERS_PATH = "packages/tagger/triggers.jsonl";
/** The printed trigger condition: a trigger word, then everything up to the comma that ends it. A
 *  comma inside a short list ("whenever you cast an instant, sorcery, or Wizard spell,") does not end
 *  it: one followed by list items of one or two words and then ", or" / ", and", one that is itself
 *  ", or" / ", and" before a short item, or one between two "non-" adjectives ("a noncreature,
 *  nonland card"). CEILING: an EFFECT that is itself such a list joins the preamble ("at the beginning
 *  of your upkeep, choose flying, first strike, trample, or ..."; 2 rows); the grammar reads no
 *  template there and answers null, so that clause keeps the stored trigger. */
const PREAMBLE = /^\s*((?:whenever|when|at the beginning of|at end of)\b(?:[^,]|, (?=(?:[^, ]+(?: [^, ]+)?, )+(?:or|and|and\/or) )|, (?:or|and|and\/or) (?=[^,]+,)|, (?=non[a-z]+ [a-z]+))*),/i;

/** A card with no comma in its name still shortens itself to its first word ("When Imskir enters",
 *  Imskir Iron-Eater) -- the rule `isSelfSubject` already reads, never for a creature type or an
 *  article ("Whenever a Goblin enters" on Goblin Bombardment is the class). */
function shortNameAsTilde(preamble: string, name: string): string {
  let out = preamble;
  for (const face of name.split(" // ")) {
    const first = withoutArticle(face.trim()).split(/[\s,]+/)[0] ?? "";
    if (first.length < 3 || SUBTYPES.has(first.toLowerCase()) || !/^\p{Lu}/u.test(first)) continue;
    // Only where a subject stands (after the trigger word, "or", "and", "by") and a lower-case word
    // follows: "Rosie Cotton" is not "~ Cotton", and "named Labyrinth of Skophos" is not the card.
    out = out.replace(new RegExp(`(?<=(?:^(?:When|Whenever)| or| and| by) )${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?= [a-z])`, "gu"), "~");
  }
  return out;
}

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
    // The name is "~" BEFORE the cut: a name with a comma in it ("Gisela, the Broken Blade") would
    // otherwise end the preamble.
    const m = PREAMBLE.exec(selfAsTilde(text, d.name));
    if (!m) { unprinted++; continue; }
    const row = JSON.stringify({
      preamble: shortNameAsTilde(m[1]!.trim(), d.name),
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
