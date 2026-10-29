// LOCAL RESEARCH ONLY (#1406): every non-token derived card's similar list, with build-static's per-tier caps, written as
// stable "seed -> candidate : tier" lines so two derive/similar.ts states can be diffed row by row. Prints tier totals.
// Usage: npx tsx research/matcher/similar-census.ts <out.txt>
import { writeFileSync } from "node:fs";
import { connect, loadConfig } from "@edh-seer/data";
import { similarIndex } from "../../packages/matcher/src/similar.js";
const store = await connect(loadConfig());
const rows = await store.db.collection("cardTagsDerived").find({ isToken: { $ne: true } }).toArray() as any[];
const names = new Map((await store.cards.find({}, { projection: { name: 1 } } as never).toArray() as any[]).map((c) => [c._id, c.name]));
const cards = rows.flatMap((d, id) => { const name = names.get(d.oracleId); return name ? [{ id, name, tags: d.tags ?? d }] : []; });
const idx = similarIndex(cards);
const out: string[] = []; const tiers: Record<string, number> = {};
for (const c of cards) for (const h of idx.similarTo(c.id, { perTier: { same: 12, close: 12, output: 8 } })) {
  out.push(`${c.name} -> ${h.name} : ${h.tier} | ${h.chips.map((x: any) => x.label).join(", ")}`); tiers[h.tier] = (tiers[h.tier] ?? 0) + 1;
}
out.sort(); writeFileSync(process.argv[2]!, out.join("\n") + "\n");
console.log("cards", cards.length, "rows", out.length, JSON.stringify(tiers));
await store.close();
