/** G3 FOR #896 TASK 7 (plan: docs/superpowers/specs/2026-10-02-card-grammar-model-free-design.md):
 *  for every card in the clause store, its grammar-only clause records -- complete, or what blocked
 *  them -- and, for a complete card, whether it derives the same abilities as from the stored model
 *  answer. Differences grouped by the fields that differ (`grammar-only-core.ts`).
 *
 *    npx tsx packages/instruments/src/grammar-only.ts            # the summary and the largest groups
 *
 *  Reads Mongo (the clause store); writes docs/measurements/card-grammar/grammar-only.json. */
import { mkdirSync, writeFileSync } from "node:fs";
import { connect, isStickerCard, loadConfig } from "@edh-seer/data";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import { deriveDiff } from "./grammar-only-core.js";

const OUT = "docs/measurements/card-grammar";
const store = await connect(loadConfig());
const docs = await store.db.collection("cardClauses").find({ isToken: { $ne: true } } as never).toArray();
let total = 0, complete = 0, same = 0;
const blockers: Record<string, number> = {};
const groups = new Map<string, string[]>();
for (const doc of docs as unknown as { oracleId: string; name: string; canonical: never[] }[]) {
  const card = await store.cards.findOne({ _id: doc.oracleId } as never);
  if (!card || isStickerCard(card)) continue;
  total++;
  const g = grammarClauseRecords(card);
  if (!g.complete) { const k = g.blocker!.kind; blockers[k] = (blockers[k] ?? 0) + 1; continue; }
  complete++;
  const stored = deriveCardTags(deriveInputOf(card as never, doc.oracleId, doc.name, doc.canonical)).abilities;
  const grammar = deriveCardTags(deriveInputOf(card as never, doc.oracleId, doc.name, g.records)).abilities;
  const key = deriveDiff(stored, grammar);
  if (key === null) { same++; continue; }
  (groups.get(key) ?? groups.set(key, []).get(key)!).push(doc.name);
}
await store.close();
const sorted = [...groups].sort((a, b) => b[1].length - a[1].length);
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/grammar-only.json`, JSON.stringify({ total, complete, same, blockers, groups: Object.fromEntries(sorted.map(([k, v]) => [k, { cards: v.length, examples: v.slice(0, 12) }])) }, null, 1) + "\n");
const pct = (n: number, d: number) => `${(100 * n / (d || 1)).toFixed(1)}%`;
console.log(`cards ${total}; complete ${complete} (${pct(complete, total)}); derive identical ${same} (${pct(same, complete)} of complete)`);
console.log(`blocked: ${Object.entries(blockers).map(([k, v]) => `${k} ${v}`).join(", ")}`);
for (const [k, v] of sorted.slice(0, 25)) console.log(`${String(v.length).padStart(6)}  ${k}  e.g. ${v.slice(0, 3).join("; ")}`);
