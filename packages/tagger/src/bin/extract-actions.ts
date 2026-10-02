/** FREE. The action census for the card grammar (#896, task 6): every clause's PRINTED effect text
 *  (`effectText`: after the trigger preamble and its intervening if, the card's name written "~")
 *  beside the actions the clause store holds for it, with the number of cards, written to the
 *  tracked fixture `packages/tagger/actions.jsonl.gz`. `packages/instruments/src/action-diff.ts` runs a
 *  candidate action grammar against the stored actions over it.
 *
 *  An activated clause's COST rides beside it (`cost`): the store writes its actions too.
 *
 *  One line per distinct (effect, abilityType, cost, actions), sorted by cards descending then by the line
 *  itself, so a re-run is byte-identical and a diff shows only what moved. Clauses with no action
 *  (keywords, `none`) are left out.
 *
 *  Usage: npx tsx packages/tagger/src/bin/extract-actions.ts */
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { connect, isStickerCard, loadConfig } from "@edh-seer/data";
import { CLAUSES_COLLECTION, type CardClausesDoc } from "../clause-store.js";
import { clauseCosts, clauseTexts } from "../derive-input.js";
import { effectText } from "../grammar/preamble.js";
import { selfAsTilde } from "../grammar/self-as-tilde.js";

/** Gzipped: 31,000 rows are 7.7 MB of text, 5x the phrase census. Node's gzip writes no timestamp,
 *  so a re-run is still byte-identical. */
const ACTIONS_PATH = "packages/tagger/actions.jsonl.gz";

const store = await connect(loadConfig());
const rows = new Map<string, Set<string>>();
let clauses = 0, actions = 0;
const docs = store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION).find({ isToken: { $ne: true } } as never, { projection: { oracleId: 1, name: 1, canonical: 1 } });
for await (const d of docs) {
  const card = await store.cards.findOne({ _id: d.oracleId } as never);
  // Sticker cards are outside the engine (owner 2026-10-02): not in the census either.
  if (!card || isStickerCard(card as never)) continue;
  const texts = clauseTexts(card as never);
  // The store writes a COST's actions too ("Sacrifice this artifact: Draw a card." is sacrifice +
  // draw), and `segment()` keeps the cost out of the clause text, so the row carries it.
  const costs = clauseCosts(card as never);
  for (const c of d.canonical ?? []) {
    const acts = (c.actions ?? []).filter((a) => a.verb && a.verb !== "none");
    if (acts.length === 0) continue;
    clauses++; actions += acts.length;
    const row = JSON.stringify({
      effect: effectText(texts[c.id] ?? "", d.name),
      type: c.abilityType ?? null,
      ...(costs[c.id] ? { cost: selfAsTilde(costs[c.id]!, d.name) } : {}),
      actions: acts.map((a) => ({
        verb: a.verb,
        object: selfAsTilde((a.object ?? "").trim(), d.name),
        ...(a.fromZone ? { fromZone: a.fromZone } : {}),
        ...(a.toZone ? { toZone: a.toZone } : {}),
        ...(a.amount != null && a.amount !== "" ? { amount: String(a.amount) } : {}),
        ...(a.optional ? { optional: true } : {}),
      })),
    });
    (rows.get(row) ?? rows.set(row, new Set()).get(row)!).add(d.oracleId);
  }
}
await store.close();

const lines = [...rows].map(([row, ids]) => ({ row, cards: ids.size }))
  .sort((a, b) => b.cards - a.cards || (a.row < b.row ? -1 : a.row > b.row ? 1 : 0))
  .map(({ row, cards }) => `${row.slice(0, -1)},"cards":${cards}}`);
writeFileSync(ACTIONS_PATH, gzipSync(lines.join("\n") + "\n", { level: 9 }));
console.log(`clauses with actions ${clauses}; actions ${actions}; ${lines.length} distinct rows -> ${ACTIONS_PATH}`);
