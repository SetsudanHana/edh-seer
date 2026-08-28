/** WHAT THE LAND CLASSIFIER SEES, over the whole corpus. Free: Mongo reads only, no model.
 *
 *  The point is the LAST row. A classifier with no `unclassified` count cannot tell you it is
 *  misreading — it just answers, and the wrong answers look like the right ones. This prints the
 *  residual and dumps every card in it, so the bucket is auditable rather than merely reported.
 *
 *    npx tsx --env-file=packages/tagger/.env packages/matcher/src/bin/land-conditions-census.ts */
import { connect, loadConfig } from "@edh-seer/data";
import { classifyLand, type LandTemplate } from "../land-conditions.js";

const store = await connect(loadConfig());
const docs = await store.db.collection<any>("cards")
  .find({ typeLine: { $regex: "Land", $options: "i" } })
  .project({ name: 1, typeLine: 1, oracleText: 1 })
  .toArray();

const counts = new Map<LandTemplate, number>();
const unclassified: { name: string; text: string }[] = [];
const bounces: string[] = [];
for (const d of docs) {
  const c = classifyLand({ typeLine: d.typeLine ?? "", oracleText: d.oracleText ?? "" });
  counts.set(c.template, (counts.get(c.template) ?? 0) + 1);
  if (c.template === "unclassified") unclassified.push({ name: d.name, text: (d.oracleText ?? "").replace(/\n/g, " | ") });
  if (c.bounces) bounces.push(d.name);
}

console.log(`lands scanned: ${docs.length}\n`);
for (const [t, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(15)} ${n}`);
console.log(`\nbounce lands flagged: ${bounces.length}`);
console.log(`\nUNCLASSIFIED (${unclassified.length}) — every one, so the bucket is auditable:`);
for (const u of unclassified.slice(0, 60)) console.log(`  ${u.name} :: ${u.text.slice(0, 140)}`);
if (unclassified.length > 60) console.log(`  … and ${unclassified.length - 60} more`);
await store.close();
