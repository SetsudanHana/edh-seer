/** Every derived speed-increase ability whose `grants` is undefined or empty (DV-current). Free, read-only.
 *  A keyword-less speed-increase renders "grants haste" (sentence.ts) and defaults to haste (edges.ts). */
import { connect, loadConfig } from "@edh-seer/data";
const store = await connect(loadConfig());
const docs = await store.db.collection("cardTagsDerived").find({ "abilities.effect.kind": "speed-increase" }).toArray() as any[];
let total = 0, bare = 0;
const lines: string[] = [];
for (const d of docs) for (const a of d.abilities ?? []) {
  if (a.effect?.kind !== "speed-increase") continue;
  total++;
  if (!a.grants || a.grants.length === 0) { bare++; lines.push(`${(await store.cards.findOne({ _id: d.oracleId } as never, { projection: { name: 1 } }) as any)?.name ?? d.oracleId} | ${((await store.cards.findOne({ _id: d.oracleId } as never, { projection: { oracleText: 1 } }) as any)?.oracleText ?? "").replace(/\n/g, " / ")} | ${a.effect?.subject?.type ?? ""} ${JSON.stringify(a.trigger?.verbs ?? "")}`); }
}
console.log(`speed-increase abilities ${total}, with no grants ${bare}`);
console.log([...new Set(lines)].sort().join("\n"));
process.exit(0);
