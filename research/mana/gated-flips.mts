/** EVERY CARD OF THE DERIVED CORPUS WHOSE netYield / colouredNetYield / netPositiveMana MOVES WHEN ITS GATED LINES COUNT (#1169 2b-2): "gated counted" (the reading before the gate was
 *  held against a card, e1fbb480) against "gated not counted" (no deck to judge it against: ef13ea04, and still the deck-free answer). Per-deck verdicts, and what each census deck's
 *  verdict does to these three, are gated-lines.mts's. `npx tsx research/mana/gated-flips.mts` (env sourced, sandbox off). */
const R = "../../packages";
const data = await import(`${R}/data/src/index.ts`);
const sj = await import(`${R}/matcher/src/same-job.ts`);
const store = await data.connect(data.loadConfig());
const rows: any[] = await store.db.collection("cardTagsDerived").find({ manaLines: { $elemMatch: { gate: { $ne: null } } } }, { projection: { oracleId: 1, manaLines: 1, abilities: 1, characteristics: 1, isToken: 1 } }).toArray();
let n = 0;
const out: string[] = [];
for (const t of rows) {
  if (t.isToken) continue;
  const c: any = await store.cards.findOne({ _id: t.oracleId } as never);
  if (!c) continue;
  const dc: any = { card: c, tags: t };
  const un: any = { card: c, tags: { ...t, manaLines: t.manaLines.map((l: any) => ({ ...l, gate: null })) } };
  const a = [sj.netYield(un), sj.colouredNetYield(un), sj.netPositiveMana(un)], b = [sj.netYield(dc), sj.colouredNetYield(dc), sj.netPositiveMana(dc)];
  n++;
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${c.name} [${(c.typeLine ?? "").split("—")[0]!.trim()}]: netYield ${a[0]} -> ${b[0]}, colouredNetYield ${a[1]} -> ${b[1]}, netPositiveMana ${a[2]} -> ${b[2]}  (gates: ${[...new Set(t.manaLines.filter((l: any) => l.gate).map((l: any) => l.gate))].join(" ; ")})`);
}
console.log(`${n} derived non-token cards with a gated mana line; ${out.length} move:`);
for (const l of out.sort()) console.log("  " + l);
await store.close();
