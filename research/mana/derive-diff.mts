/** OLD-VS-NEW DERIVE DIFF OF THE MANA KEYS (#1169): derives every clause doc in memory (no Mongo write) and lists the cards whose
 *  `manaLines` differ from the stored derived row, with the changed lines. Run from the repo root, env sourced, sandbox off:
 *  `npx tsx research/mana/derive-diff.mts`. Run it BEFORE `derive-corpus --force` of a derive change: after, the stored rows are the new ones. */
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const dw = await import(`${R}/tagger/src/derive-worker.ts`);
const store = await data.connect(data.loadConfig());
const stored = new Map<string, any>((await store.db.collection("cardTagsDerived").find({}, { projection: { oracleId: 1, manaLines: 1, landFetch: 1, staticFixer: 1, isOneShot: 1, suspendOnly: 1 } }).toArray()).map((r: any) => [r.oracleId, r]));
let n = 0, changed = 0;
for (const doc of await store.db.collection("cardClauses").find({}).toArray() as any[]) {
  if (doc.isToken) continue;
  const source: any = await store.cards.findOne({ _id: doc.oracleId } as never);
  if (!source) continue;
  const now = dw.deriveRow({ doc, source, isToken: false }).tags;
  const old = stored.get(doc.oracleId);
  n++;
  const a = JSON.stringify(old?.manaLines ?? []), b = JSON.stringify(now.manaLines ?? []);
  if (a === b) continue;
  changed++;
  const oa: any[] = old?.manaLines ?? [], nb: any[] = now.manaLines ?? [];
  console.log(`${source.name}: ${source.typeLine} | ${(source.oracleText ?? "").replace(/\n/g, " / ")}`);
  console.log(`   ${oa.length} lines -> ${nb.length}`);
  for (let i = 0; i < Math.max(oa.length, nb.length); i++) if (JSON.stringify(oa[i]) !== JSON.stringify(nb[i])) {
    const keys = [...new Set([...Object.keys(oa[i] ?? {}), ...Object.keys(nb[i] ?? {})])].filter((k) => JSON.stringify(oa[i]?.[k]) !== JSON.stringify(nb[i]?.[k]));
    console.log(`   line ${i}: gate ${oa[i]?.gate?.text ?? oa[i]?.gate ?? "-"} -> ${nb[i]?.gate?.text ?? nb[i]?.gate ?? "-"} [${nb[i]?.source ?? oa[i]?.source}] differs in ${keys.join(",")}`);
  }
}
console.log(`${n} cards derived, ${changed} with different manaLines`);
await store.close();
