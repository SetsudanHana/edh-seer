// LOCAL RESEARCH ONLY (#1302): for named cards, the grammar-only triage key (`deriveDiff`) between the stored-model derive and the printed-text derive, and the abilities that differ. FREE, read-only.
// npx tsx research/tagger/grammar-switch-probe.ts "Archghoul of Thraben" ...   (no names: every card whose group key is not null AND whose abilities mention a to-hand / toHand marker)
import { connect, loadConfig } from "@edh-seer/data";
import { deriveCardTags } from "../../packages/tagger/src/derive/derive.js";
import { deriveInputOf } from "../../packages/tagger/src/derive-input.js";
import { grammarClauseRecords } from "../../packages/tagger/src/grammar/clause-record.js";
import { deriveDiff, lostClaims } from "../../packages/tagger/src/grammar/derive-diff.js";
import triage from "../../packages/tagger/grammar-only-triage.json" with { type: "json" };
const store = await connect(loadConfig());
const names = process.argv.slice(2);
const filter = names.length ? { name: { $in: names } } : { isToken: { $ne: true } };
const strip = (a: unknown) => JSON.stringify(a).replace(process.env.FULL ? /$^/ : /"subject":\{[^{}]*\}/g, '"subject":{…}');
for await (const doc of store.db.collection<any>("cardClauses").find(filter)) {
  const src = await store.cards.findOne({ _id: doc.oracleId } as never) as any;
  const g = grammarClauseRecords(src);
  if (!g.complete) continue;
  // Instrument and switch must key the same readings: the switch compares UNFOLDED abilities (see the #1391 comment in derive-worker.ts).
  const m = deriveCardTags(deriveInputOf(src, doc.oracleId, doc.name, doc.canonical), { foldGrantTwins: false });
  const gr = deriveCardTags(deriveInputOf(src, doc.oracleId, doc.name, g.records, undefined, g.readings), { foldGrantTwins: false });
  const key = deriveDiff(m.abilities, gr.abilities);
  if (key === null) continue;
  const hand = JSON.stringify(m.abilities.concat(gr.abilities)).match(/"to-hand"|"toHand"/);
  if (!names.length && !hand) continue;
  const label = (triage.groups as Record<string, { label: string }>)[key]?.label ?? "UNLABELLED";
  console.log(`== ${doc.name} | key ${key} | ${label} | lostClaims ${lostClaims(m.abilities, gr.abilities).length}`);
  if (names.length) { for (const a of m.abilities) console.log("  MODEL  " + strip(a).slice(0, 300)); for (const a of gr.abilities) console.log("  GRAMM  " + strip(a).slice(0, 300)); }
}
await store.close();
