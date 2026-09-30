// LOCAL RESEARCH ONLY: re-derive every card in memory and compare with the stored cardTagsDerived.
// Proves a refactor of derive changed nothing (#896 task 4 step 1). Prints the differing cards.
import { connect, loadConfig } from "@edh-seer/data";
import { charsFrom, clauseCosts, clauseFaces, clauseRequires, clauseTexts, grantedTokenClauses } from "../../packages/tagger/src/derive-input.js";
import { deriveCardTags } from "../../packages/tagger/src/derive/derive.js";
const store = await connect(loadConfig());
const stored = new Map((await store.db.collection("cardTagsDerived").find({ isToken: { $ne: true } }).toArray()).map((d: any) => [d.oracleId, d]));
let same = 0, diff = 0;
for (const doc of await store.db.collection("cardClauses").find({ isToken: { $ne: true } }).toArray() as any[]) {
  const src = await store.cards.findOne({ _id: doc.oracleId } as never) as any;
  if (!src) continue;
  const tags = deriveCardTags({ oracleId: doc.oracleId, name: doc.name, clauses: doc.canonical, characteristics: charsFrom(src),
    clauseTexts: clauseTexts(src), clauseRequires: clauseRequires(src), clauseCosts: clauseCosts(src), clauseFaces: clauseFaces(src),
    oracleText: src.oracleText, grantedToken: grantedTokenClauses(src) }) as any;
  const old = stored.get(doc.oracleId) ?? {};
  const pick = (t: any) => JSON.stringify({ abilities: t.abilities, unclaimed: t.unclaimed, characteristics: t.characteristics });
  if (pick(tags) === pick(old)) same++; else { diff++; if (diff <= 10) console.log("DIFF", doc.name); if (process.env.SHOW === doc.name) { const a = JSON.parse(pick(tags)), b = JSON.parse(pick(old)); for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log(k, "\nNEW", String(JSON.stringify(a[k])).slice(0, 1500), "\nOLD", String(JSON.stringify(b[k])).slice(0, 1500)); } }
}
console.log(`identical ${same}, different ${diff}`);
await store.close();
