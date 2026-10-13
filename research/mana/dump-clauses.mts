/** Prints a card's stored clause records (cardClauses): `npx tsx research/mana/dump-clauses.mts "Name"` (env sourced, sandbox off). */
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const store = await data.connect(data.loadConfig());
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const d: any = await store.db.collection("cards").findOne({ name: new RegExp("^" + esc(process.argv[2]!) + "( //|$)") });
for (const col of ["cardClauses"]) {
  const t: any = await store.db.collection(col).findOne({ $or: [{ oracleId: d._id }, { _id: d._id }] } as any);
  console.log(col, JSON.stringify(t, null, 1)?.slice(0, 6000));
}
await store.close();
