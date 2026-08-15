/** Would a CLAUSE-scoped phantom guard refuse real triggers?
 *
 *  `hasPhantomTrigger` is card-scoped: one cue anywhere in the card clears every clause. Refusing at
 *  derive time needs the check at the clause the trigger actually sits in, which is strictly harsher
 *  — a trigger whose cue word lives in a neighbouring sentence would be refused wrongly. Measure the
 *  difference before wiring anything. Free, read-only. */
import { connect, loadConfig } from "@mtg/data";
import { CLAUSES_COLLECTION, hasPhantomTrigger, type CardClausesDoc } from "../clause-store.js";
import { segment } from "../segment.js";

const store = await connect(loadConfig());

const docs = await store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION).find({}).toArray();
let cardScoped = 0, clauseScoped = 0;
const extra: string[] = [];
for (const d of docs) {
  const card = await store.cards.findOne({ _id: d.oracleId } as never) as unknown as
    { name: string; oracleText?: string; keywords?: string[]; typeLine?: string } | null;
  const text = card?.oracleText ?? "";
  if (!text) continue;
  const fresh = segment(text, card?.keywords ?? [], card?.typeLine ?? "");
  // Same guard the resource-ledger work documents: a stored/fresh clause-count mismatch slides the
  // ids, so a reconstructed text may belong to a different clause. Refuse to judge those.
  if (fresh.length !== d.canonical.length) continue;
  const texts: Record<number, string> = {};
  for (const c of fresh) texts[c.id] = c.text;

  for (const c of d.canonical) {
    if (!c.trigger?.event) continue;
    const one = { ...d, canonical: [c] };
    const byCard = hasPhantomTrigger(one, text);
    const byClause = hasPhantomTrigger(one, texts[c.id] ?? text);
    if (byCard) cardScoped++;
    if (byClause) clauseScoped++;
    if (byClause && !byCard) {
      extra.push(`  ${card?.name} trigger=${c.trigger.event}\n     clause: ${(texts[c.id] ?? "").slice(0, 130)}`);
    }
  }
}

console.log(`trigger clauses flagged CARD-scoped:   ${cardScoped}`);
console.log(`trigger clauses flagged CLAUSE-scoped: ${clauseScoped}`);
console.log(`\nflagged by clause scope ONLY — these are what a derive-time guard would newly refuse (${extra.length}):`);
for (const e of extra) console.log(e);

await store.close();
process.exit(0);
