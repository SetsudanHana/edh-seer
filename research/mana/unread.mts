/** Lists every derived manaLine with `unread: true` and the card's text. `npx tsx research/mana/unread.mts` */
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const store = await data.connect(data.loadConfig());
const rows = await store.db.collection("cardTagsDerived").find({ "manaLines.unread": true }, { projection: { oracleId: 1, manaLines: 1 } }).toArray();
const cards: any[] = await store.cards.find({ _id: { $in: rows.map((r: any) => r.oracleId) } } as never).toArray();
const by = new Map(cards.map((c) => [c._id, c]));
let n = 0;
for (const r of rows) for (const l of r.manaLines.filter((x: any) => x.unread)) { n++; console.log(by.get(r.oracleId)?.name, "|", l.source, "|", (by.get(r.oracleId)?.oracleText ?? "").replace(/\n/g, " / ").slice(0, 200)); }
console.log("UNREAD LINES", n);
await store.close();
