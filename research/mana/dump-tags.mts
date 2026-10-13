/** Prints a card's derived tags document keys, optionally one key in full: `npx tsx research/mana/dump-tags.mts "Name" [key]` (env sourced, sandbox off). */
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const store = await data.connect(data.loadConfig());
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const [name, key] = process.argv.slice(2);
const d: any = await store.db.collection("cards").findOne({ name: new RegExp("^" + esc(name!) + "( //|$)") });
const t: any = await store.db.collection("cardTagsDerived").findOne({ oracleId: d._id });
console.log(Object.keys(t));
console.log(JSON.stringify(key ? t[key] : { deriveVersion: t.deriveVersion, clauseSource: t.clauseSource }, null, 1));
await store.close();
