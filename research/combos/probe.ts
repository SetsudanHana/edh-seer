// LOCAL RESEARCH ONLY (#726): derive named cards from Mongo, print clauses and abilities.
import { connect, loadConfig } from "@edh-seer/data";
import { charsFrom, clauseCosts, clauseFaces, clauseRequires, clauseTexts, grantedTokenClauses } from "../../packages/tagger/src/derive-input.js";
import { deriveCardTags } from "../../packages/tagger/src/derive/derive.js";
const store = await connect(loadConfig());
for (const name of process.argv.slice(2)) {
  const src = await store.cards.findOne({ name } as never) as any;
  const doc = src && await store.db.collection("cardClauses").findOne({ oracleId: src._id }) as any;
  if (!doc) { console.log("MISSING", name); continue; }
  const tags = deriveCardTags({ oracleId: doc.oracleId, name: doc.name, clauses: doc.canonical,
    characteristics: charsFrom(src), clauseTexts: clauseTexts(src), clauseRequires: clauseRequires(src),
    clauseCosts: clauseCosts(src), clauseFaces: clauseFaces(src), oracleText: src.oracleText,
    grantedToken: grantedTokenClauses(src) });
  console.log("##", name, "\n", JSON.stringify(doc.canonical, null, 1));
  for (const a of tags.abilities) console.log(JSON.stringify(a));
}
await store.close();
