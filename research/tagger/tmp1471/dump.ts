import { connect, loadConfig } from "@edh-seer/data";
const store = await connect(loadConfig());
const names = process.argv.slice(2);
for (const n of names) {
  const c: any = await store.cards.findOne({ name: n });
  const d: any = await store.db.collection("cardTagsDerived").findOne({ oracleId: c?._id });
  console.log("=====", n, JSON.stringify(c?.oracleText), c?.typeLine);
  for (const a of d?.abilities ?? []) {
    if (!JSON.stringify(a).includes("damage")) continue;
    console.log(JSON.stringify({ kind: a.kind, trigger: a.trigger, emits: a.emits, effect: a.effect }));
  }
}
await store.close();
