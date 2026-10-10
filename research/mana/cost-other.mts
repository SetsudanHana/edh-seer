/** Tallies `cost.other` pieces on lines that would otherwise be colour sources (#1169 2a review). `npx tsx research/mana/cost-other.mts` */
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const store = await data.connect(data.loadConfig());
const rows = await store.db.collection("cardTagsDerived").find({ "manaLines.cost.other.0": { $exists: true } }, { projection: { oracleId: 1, manaLines: 1 } }).toArray();
const cards: any[] = await store.cards.find({ _id: { $in: rows.map((r: any) => r.oracleId) } } as never).toArray();
const by = new Map(cards.map((c) => [c._id, c.name]));
const tally = new Map<string, string[]>();
for (const r of rows) for (const l of r.manaLines) {
  if (!(l.source === "activated" || l.source === "static-grant") || l.cost.other.length === 0) continue;
  if (l.unread || l.gate !== null || l.restriction !== null || l.cost.sacrificeSelf || l.cost.sacrificeOther || l.cost.counters !== null || l.cost.tapOther) continue;
  if (!(l.cost.tap || l.source === "static-grant")) continue;
  for (const o of l.cost.other) { const k = o.toLowerCase().replace(/\d+|x\b/g, "N"); (tally.get(k) ?? tally.set(k, []).get(k)!).push(by.get(r.oracleId)); }
}
for (const [k, v] of [...tally].sort((a, b) => b[1].length - a[1].length)) console.log(v.length, "|", k, "|", [...new Set(v)].slice(0, 6).join("; "));
await store.close();
