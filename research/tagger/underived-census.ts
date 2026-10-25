/** THE COMMANDER-LEGAL CARDS THAT DERIVE NOTHING, each with the clause and phrase the grammar stops on
 *  (#1210). Free: `grammarClauseRecords(card).blocker` (owner 2026-10-14: extend the grammar before
 *  proposing a paid run). Fixing one blocker may expose the next, so re-run after each shape.
 *  The population is derive-corpus's own scope (`deriveScopeFilter`): commander-legal cards plus upcoming spoilers (#1348). */
import { connect, loadConfig } from "@edh-seer/data";
import { grammarClauseRecords } from "../../packages/tagger/src/grammar/clause-record.js";
import { segment } from "../../packages/tagger/src/segment.js";
import { deriveScopeFilter } from "../../packages/tagger/src/derive-scope.js";

const store = await connect(loadConfig());
const derived = new Set((await store.db.collection("cardTagsDerived").find({}, { projection: { oracleId: 1 } }).toArray()).map((d) => d.oracleId as string));
const rows: { name: string; kind: string; clause: string; phrase: string }[] = [];
for await (const card of store.cards.find(deriveScopeFilter() as never)) {
  const c = card as unknown as { _id: string; name: string; oracleText?: string; keywords?: string[]; typeLine?: string };
  if (derived.has(c._id)) continue;
  const g = grammarClauseRecords(c);
  const clause = g.blocker ? segment(c.oracleText ?? "", c.keywords ?? [], c.typeLine ?? "").find((s) => s.id === g.blocker!.clause)?.text ?? "" : "";
  rows.push({ name: c.name, kind: g.complete ? "COMPLETE (not yet derived)" : g.blocker!.kind, clause, phrase: g.blocker?.phrase ?? "" });
}
console.log(`cards in derive scope with no derived row: ${rows.length}`);
for (const r of rows.sort((a, b) => a.name.localeCompare(b.name))) console.log(`- ${r.name} [${r.kind}] ${r.phrase ? `«${r.phrase}» ` : ""}in: ${r.clause}`);
await store.close();
