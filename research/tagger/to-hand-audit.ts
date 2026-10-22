// LOCAL RESEARCH ONLY (#1302): every derived to-hand ability with its clause text, grouped by (amount, chooses), to read the amount and choice by eye. FREE, read-only.
import { connect, loadConfig } from "@edh-seer/data";
import { clauseTexts } from "../../packages/tagger/src/derive-input.js";
const store = await connect(loadConfig());
const groups = new Map<string, string[]>();
for await (const row of store.db.collection<any>("cardTagsDerived").find({ "abilities.effect.kind": "to-hand" })) {
  const card = await store.cards.findOne({ _id: row.oracleId } as never) as any;
  const texts = card ? clauseTexts(card) : {};
  for (const a of row.abilities) if (a.effect.kind === "to-hand") {
    const k = `${a.amount} chooses=${a.chooses ?? false}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(`${card?.name} #${a.clause} [${a.kind}] ${(texts[a.clause] ?? "").replace(/\n/g, " ").slice(0, Number(process.env.W ?? 200))}`);
  }
}
const want = process.env.G;
for (const [k, v] of [...groups].sort()) { console.log(`## ${k}: ${v.length}`); if (!want || want === k) for (const l of v.sort().slice(0, Number(process.env.N ?? 8))) console.log("  ", l); }
await store.close();
