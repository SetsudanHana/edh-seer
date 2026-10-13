/** Appends the named cards (card fields and their CURRENT derived tags, from Mongo) to a matcher fixture file in the shape `same-job.fixtures.json` holds (#1169 2b-2).
 *  `npx tsx research/mana/add-fixture-cards.mts packages/matcher/src/same-job.fixtures.json "Mox Jasper" "Mox Opal" ...` (env sourced, sandbox off). Existing entries are left alone. */
import { readFileSync, writeFileSync } from "node:fs";
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const store = await data.connect(data.loadConfig());
const [file, ...names] = process.argv.slice(2);
const fx = JSON.parse(readFileSync(file!, "utf8")) as Record<string, unknown>;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
for (const n of names) {
  if (fx[n]) { console.log("already", n); continue; }
  const d: any = await store.db.collection("cards").findOne({ name: new RegExp("^" + esc(n) + "( //|$)") });
  if (!d) { console.log("NO CARD", n); continue; }
  const t: any = await store.db.collection("cardTagsDerived").findOne({ oracleId: d._id });
  if (!t) { console.log("NO TAGS", n); continue; }
  fx[n] = {
    card: { name: d.name, typeLine: d.typeLine, manaValue: d.manaValue, oracleText: d.oracleText, keywords: d.keywords ?? [], colors: d.colors ?? [], colorIdentity: d.colorIdentity ?? [], layout: d.layout ?? "normal", manaCost: d.manaCost },
    tags: t,
  };
  console.log("added", n);
}
writeFileSync(file!, JSON.stringify(fx, null, 1) + "\n");
await store.close();
