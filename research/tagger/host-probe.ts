// LOCAL RESEARCH ONLY (#1315): print a card's oracle text, stored clauses and derived abilities (kind, amount, grants, clause, host). FREE: reads Mongo, writes nothing.
// Run from the repo root after `set -a && source packages/tagger/.env && set +a`: npx tsx research/tagger/host-probe.ts "Rancor" "Pacifism"
import { connect, loadConfig } from "@edh-seer/data";
const store = await connect(loadConfig());
for (const name of process.argv.slice(2)) {
  const doc = await store.db.collection("cardClauses").findOne({ name, isToken: { $ne: true } }) as any;
  const d = await store.db.collection("cardTagsDerived").findOne({ oracleId: doc?.oracleId }) as any;
  const src = await store.cards.findOne({ _id: doc?.oracleId } as never) as any;
  console.log("==", name, "|", src?.typeLine, "|", d?.clauseSource, d?.normalizeVersion);
  console.log(String(src?.oracleText).replace(/\n/g, " / "));
  console.log("CLAUSES", JSON.stringify(doc?.clauses));
  console.log("ABILITIES", JSON.stringify(d?.abilities?.map((a: any) => ({ k: a.kind, e: a.effect, amount: a.amount, g: a.grants, c: a.clause, host: a.host }))));
}
await store.close();
