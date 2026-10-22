// LOCAL RESEARCH ONLY (#1302): every stored library->hand put in a clause with no search word, with its object, what derive made of that clause, and the clause text. FREE, read-only.
// Run from the repo root after `set -a && source packages/tagger/.env && set +a`: npx tsx research/tagger/to-hand-puts.ts > out.txt
import { connect, loadConfig } from "@edh-seer/data";
import { clauseTexts } from "../../packages/tagger/src/derive-input.js";
const store = await connect(loadConfig());
const derived = new Map<string, any>();
for await (const d of store.db.collection<any>("cardTagsDerived").find({ isToken: { $ne: true } })) derived.set(d.oracleId, d);
for await (const doc of store.db.collection<any>("cardClauses").find({ isToken: { $ne: true } })) {
  const rows = (doc.canonical ?? []) as any[];
  const hits = rows.filter((r) => (r.actions ?? []).some((a: any) => a.verb === "put" && a.fromZone === "library" && a.toZone === "hand"));
  if (!hits.length) continue;
  const card = await store.cards.findOne({ _id: doc.oracleId } as never) as any;
  const texts = card ? clauseTexts(card) : {};
  const d = derived.get(doc.oracleId);
  for (const r of hits) {
    const text = (texts[r.id] ?? "").replace(/\n/g, " ");
    if (/\bsearch/i.test(text)) continue;
    const kinds = (d?.abilities ?? []).filter((a: any) => a.clause === r.id).map((a: any) => a.effect.kind + (a.toHand ? "[toHand]" : "") + (a.named ? "[named]" : "") + (a.netZero ? "[netZero]" : "") + (a.chooses ? "[ch]" : "") + ":" + (a.amount ?? "")).join(",");
    const objs = r.actions.filter((a: any) => a.verb === "put" && a.fromZone === "library" && a.toZone === "hand").map((a: any) => a.object).join(" | ");
    console.log(`${card?.name}\t#${r.id}\t${kinds}\t${objs}\t${text}`);
  }
}
await store.close();
