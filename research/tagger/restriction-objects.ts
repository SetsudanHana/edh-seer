// LOCAL RESEARCH ONLY (#1315): census of the `cant` actions whose object mentions attacking or blocking (not "be blocked"), grouped by object. FREE: reads Mongo, writes nothing.
// Run from the repo root after `set -a && source packages/tagger/.env && set +a`: npx tsx research/tagger/restriction-objects.ts [min-count]
import { connect, loadConfig } from "@edh-seer/data";
const store = await connect(loadConfig());
const counts = new Map<string, { n: number; ex: string[] }>();
for await (const doc of store.db.collection("cardClauses").find({ isToken: { $ne: true } }) as any) {
  for (const c of doc.clauses ?? []) for (const a of c.actions ?? []) {
    if (a.verb !== "cant" || !/\b(?:attack|block)/i.test(a.object ?? "") || /\bbe blocked\b/i.test(a.object ?? "")) continue;
    const key = String(a.object).toLowerCase().slice(0, 100);
    const e = counts.get(key) ?? { n: 0, ex: [] }; e.n++; if (e.ex.length < 3) e.ex.push(doc.name); counts.set(key, e);
  }
}
const min = Number(process.argv[2] ?? 1);
for (const [k, v] of [...counts].sort((a, b) => b[1].n - a[1].n)) if (v.n >= min) console.log(v.n, "|", k, "|", v.ex.join("; "));
await store.close();
