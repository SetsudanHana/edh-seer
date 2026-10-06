// LOCAL RESEARCH ONLY: re-derive every card in memory and compare with the stored cardTagsDerived.
// Proves a refactor of derive changed nothing (#896 task 4 step 1). Prints the differing cards.
import { connect, isStickerCard, loadConfig } from "@edh-seer/data";
// THE SAME CALL derive-corpus MAKES (2026-10-06). This built its own DeriveInput and so never took the
// card-by-card grammar switch (#896 task 7) `deriveRow` applies: after a clean `derive-corpus --force`
// it still read "identical 29458, different 2640", and every one of the 2,640 was a card the switch
// had moved to its grammar reading. A proof that re-derives by a different path proves nothing.
import { deriveRow } from "../../packages/tagger/src/derive-worker.js";
const store = await connect(loadConfig());
const stored = new Map((await store.db.collection("cardTagsDerived").find({ isToken: { $ne: true } }).toArray()).map((d: any) => [d.oracleId, d]));
let same = 0, diff = 0;
for (const doc of await store.db.collection("cardClauses").find({ isToken: { $ne: true } }).toArray() as any[]) {
  const src = await store.cards.findOne({ _id: doc.oracleId } as never) as any;
  // A STICKER CARD IS OUTSIDE THE ENGINE: derive-corpus excludes it and keeps no row for it.
  if (!src || isStickerCard(src)) continue;
  const tags = deriveRow({ doc, source: src, isToken: false }).tags as any;
  const old = stored.get(doc.oracleId) ?? {};
  const pick = (t: any) => JSON.stringify({ abilities: t.abilities, unclaimed: t.unclaimed, characteristics: t.characteristics });
  if (pick(tags) === pick(old)) same++; else { diff++; if (diff <= 10) console.log("DIFF", doc.name); if (process.env.SHOW === doc.name) { const a = JSON.parse(pick(tags)), b = JSON.parse(pick(old)); for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log(k, "\nNEW", String(JSON.stringify(a[k])).slice(0, 1500), "\nOLD", String(JSON.stringify(b[k])).slice(0, 1500)); } }
}
console.log(`identical ${same}, different ${diff}`);
await store.close();
