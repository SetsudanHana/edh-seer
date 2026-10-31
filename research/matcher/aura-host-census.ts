/** ONE-SHOT (#1417): corpus-wide census of the Aura host-removal route (CR 704.5m, `auraHostLeaves`).
 *  Consumers: every card whose characteristics carry `enchants` and that has a self dies/leaves trigger.
 *  Producers: every card with a non-self dies/leaves emit. Counts the dies:/leaves: pair reasons under
 *  edges.ts at BASE (written beside the live one for the run, so its relative imports resolve, and
 *  removed after) and the CURRENT one, and prints lost / gained by consumer.
 *
 *    npx tsx research/matcher/aura-host-census.ts 98f1c03e */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { connect, docToCard, loadConfig } from "../../packages/data/src/index.js";
import { pairReasons as pairNew } from "../../packages/matcher/src/edges.js";
import { loadHierarchy } from "../../packages/matcher/src/hierarchy.js";
import type { DeckCard } from "../../packages/matcher/src/types.js";

const base = process.argv[2];
if (!base) throw new Error("usage: aura-host-census.ts <BASE-sha>");
const stem = `edges.base-${base.replace(/[^0-9a-f]/gi, "")}`;
const oldFile = new URL(`../../packages/matcher/src/${stem}.ts`, import.meta.url);
writeFileSync(oldFile, execFileSync("git", ["show", `${base}:packages/matcher/src/edges.ts`]));
let pairOld: typeof pairNew;
try {
  pairOld = ((await import(`../../packages/matcher/src/${stem}.js`)) as { pairReasons: typeof pairNew }).pairReasons;
} finally {
  rmSync(oldFile, { force: true });
}
const store = await connect(loadConfig());
const h = loadHierarchy();
const cards = new Map<string, any>();
for await (const c of store.cards.find({})) cards.set(String(c._id), c);
const consumers: DeckCard[] = [], producers: DeckCard[] = [];
const selfDL = (a: any) => a.trigger?.subject?.self === true && a.trigger.verbs.some((v: string) => v === "dies" || v === "leaves");
for await (const t of store.db.collection("cardTagsDerived").find({})) {
  const c = cards.get(String(t.oracleId));
  if (!c) continue;
  const dc = { card: { ...c, ...docToCard(c as never) }, tags: t } as unknown as DeckCard;
  if (t.characteristics?.enchants && t.abilities.some(selfDL)) consumers.push(dc);
  if (t.abilities.some((a: any) => (a.emits ?? []).some((e: any) => (e.verb === "dies" || e.verb === "leaves") && e.subject?.self !== true))) producers.push(dc);
}
console.log(`consumers ${consumers.length}, producers ${producers.length}`);
const keep = (rs: { tag: string; consumer?: string }[]) => new Set(rs.filter((r) => r.tag.startsWith("dies:") || r.tag.startsWith("leaves:")).map((r) => r.tag));
let lost = 0, gained = 0, before = 0, after = 0;
const byC = new Map<string, { lost: string[]; gained: string[] }>();
for (const c of consumers) for (const p of producers) {
  if (p === c) continue;
  const o = keep(pairOld(p, c, h)), n = keep(pairNew(p, c, h));
  before += o.size; after += n.size;
  for (const [set, other, key] of [[o, n, "lost"], [n, o, "gained"]] as const) for (const tag of set) if (!other.has(tag)) {
    const e = byC.get(c.card.name) ?? { lost: [], gained: [] };
    e[key].push(`${p.card.name} (${tag})`); byC.set(c.card.name, e);
    if (key === "lost") lost++; else gained++;
  }
}
console.log(`reason tags before ${before}, after ${after}; lost ${lost}, gained ${gained}`);
for (const [name, e] of [...byC].sort((a, b) => b[1].lost.length - a[1].lost.length))
  console.log(`${name}: lost ${e.lost.length}, gained ${e.gained.length} | e.g. ${e.lost.slice(0, 4).join("; ")}`);
await store.close();
