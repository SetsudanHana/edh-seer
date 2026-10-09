/** Every corpus action with verb double/triple: card, object, effect kind. Free, read-only.
 *  Run before and after a change to effect-kind.ts and diff the output. */
import { connect, loadConfig } from "@edh-seer/data";
import { CLAUSES_COLLECTION, type CardClausesDoc } from "../../packages/tagger/src/clause-store.js";
import { actionEffectKind } from "../../packages/tagger/src/derive/effect-kind.js";
import { segment } from "../../packages/tagger/src/segment.js";

const store = await connect(loadConfig());
const docs = await store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION).find({}).toArray();
const rows: string[] = [];
for (const d of docs) {
  if (!JSON.stringify(d.canonical).match(/"verb":"(double|triple)"/)) continue;
  const card = await store.cards.findOne({ _id: d.oracleId } as never, { projection: { name: 1, oracleText: 1, keywords: 1, typeLine: 1 } }) as unknown as
    { name: string; oracleText?: string; keywords?: string[]; typeLine?: string } | null;
  if (!card) continue;
  const fresh = segment(card.oracleText ?? "", card.keywords ?? [], card.typeLine ?? "");
  const texts: Record<number, string> = {};
  if (fresh.length === d.canonical.length) for (const c of fresh) texts[c.id] = c.text;
  for (const c of d.canonical) for (const a of c.actions ?? []) {
    if (a.verb !== "double" && a.verb !== "triple") continue;
    const t = texts[c.id] ?? "";
    rows.push(`${card.name} | ${a.verb} | obj=${JSON.stringify(a.object)} | ${actionEffectKind(a as never, t)} | ${t.slice(0, 110)}`);
  }
}
console.log(rows.sort().join("\n"));
console.log(`\n${rows.length} actions`);
process.exit(0);
