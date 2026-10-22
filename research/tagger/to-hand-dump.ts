// LOCAL RESEARCH ONLY (#1302): the stored clauses AND the grammar's records of named cards, put actions only. FREE, read-only.
import { connect, loadConfig } from "@edh-seer/data";
import { grammarClauseRecords } from "../../packages/tagger/src/grammar/clause-record.js";
const store = await connect(loadConfig());
for (const name of process.argv.slice(2)) {
  const card = await store.cards.findOne({ name } as never) as any;
  const doc = await store.db.collection("cardClauses").findOne({ oracleId: card._id }) as any;
  const g = grammarClauseRecords(card);
  console.log(`== ${name} | complete=${g.complete} | source=${doc?.clauseSource ?? "model"} | ${card.oracleText.replace(/\n/g, " / ")}`);
  const show = (tag: string, recs: any[]) => { for (const r of recs ?? []) for (const a of r.actions ?? []) if (a.verb === "put" || a.verb === "search") console.log(`  ${tag} #${r.id} ${r.abilityType} ${JSON.stringify(a)}`); };
  show("MODEL", doc?.clauses ?? doc?.records ?? []);
  show("GRAM ", g.records);
}
await store.close();
