/** A CARD'S ORACLE TEXT AND DERIVED MANA LINES FROM MONGO, by name (#1169): `npx tsx research/mana/card-lines.mts "Mox Jasper" ...` (env sourced, sandbox off). */
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const { connect, loadConfig } = data;
const store = await connect(loadConfig());
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
for (const n of process.argv.slice(2)) {
  const docs = await store.db.collection("cards").find({ name: new RegExp("^" + esc(n) + "( //|$)") }).limit(1).toArray();
  for (const d of docs as any[]) {
    console.log("== " + d.name + " | " + d.typeLine + " | " + d.manaCost);
    console.log(d.oracleText ?? (d.faces ?? d.card_faces ?? []).map((f: any) => f.oracleText).join("\n//\n"));
    const t: any = await store.db.collection("cardTagsDerived").findOne({ oracleId: d._id } as any);
    console.log(JSON.stringify(t?.manaLines?.map((l: any) => ({ s: l.source, g: l.gate, net: l.net, am: l.amount, col: l.colours, any: l.anyColour, face: l.face, trig: l.trigger, ts: l.triggerSubject, tm: l.timing, tap: l.cost?.tap }))));
  }
}
await store.close();
