// LOCAL RESEARCH ONLY: print a card's oracle text, stored clauses and derived abilities (#1315).
import { connect, loadConfig } from "@edh-seer/data";
const store = await connect(loadConfig());
for (const name of process.argv.slice(2)) {
  const doc = await store.db.collection("cardClauses").findOne({ name, isToken: { $ne: true } }) as any;
  const d = await store.db.collection("cardTagsDerived").findOne({ oracleId: doc?.oracleId }) as any;
  const src = await store.cards.findOne({ _id: doc?.oracleId } as never) as any;
  console.log("==", name, "|", src?.typeLine, "|", d?.clauseSource, d?.normalizeVersion);
  console.log(String(src?.oracleText).replace(/\n/g, " / "));
  console.log("CLAUSES", JSON.stringify(doc?.clauses));
  console.log("ABILITIES", JSON.stringify(d?.abilities?.map((a: any) => ({ k: a.kind, e: a.effect, amount: a.amount, g: a.grants, c: a.clause }))));
}
await store.close();
