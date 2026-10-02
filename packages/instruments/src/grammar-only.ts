/** G3 FOR #896 TASK 7 (plan: docs/superpowers/specs/2026-10-02-card-grammar-model-free-design.md):
 *  for every card in the clause store, its grammar-only clause records -- complete, or what blocked
 *  them -- and, for a complete card, whether it derives the same abilities as from the stored model
 *  answer. Differences grouped by the fields that differ (`tagger/src/grammar/derive-diff.ts`).
 *
 *    npx tsx packages/instruments/src/grammar-only.ts            # the summary and the largest groups
 *
 *  Reads Mongo (the clause store); writes docs/measurements/card-grammar/grammar-only.json. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect, isStickerCard, loadConfig } from "@edh-seer/data";
import { deriveCardTags, deriveDiff, deriveInputOf, grammarClauseRecords, lostClaims } from "@edh-seer/tagger";

const OUT = "docs/measurements/card-grammar";
const store = await connect(loadConfig());
const docs = await store.db.collection("cardClauses").find({ isToken: { $ne: true } } as never).toArray();
let total = 0, complete = 0, same = 0;
const blockers: Record<string, number> = {};
const groups = new Map<string, string[]>();
const guarded: string[] = [];
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
  // The switch's guard (derive-corpus): a labelled card that would lose a claim keeps its stored answer.
  const lost = lostClaims(stored, grammar);
  if (lost.length) guarded.push(`${doc.name} [${key}] -${lost.join(" -")}`);
}
await store.close();
const sorted = [...groups].sort((a, b) => b[1].length - a[1].length);
// THE LABELS (G3): every group, labelled in packages/tagger/grammar-only-triage.json.
const triage = JSON.parse(readFileSync("packages/tagger/grammar-only-triage.json", "utf8")) as { groups: Record<string, { label: string }> };
const labelled = sorted.filter(([k]) => triage.groups[k]);
const wrong = labelled.filter(([k]) => triage.groups[k]!.label !== "grammar right");
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/grammar-only.json`, JSON.stringify({ total, complete, same, blockers, groups: Object.fromEntries(sorted.map(([k, v]) => [k, { cards: v.length, examples: v.slice(0, 12) }])) }, null, 1) + "\n");
const pct = (n: number, d: number) => `${(100 * n / (d || 1)).toFixed(1)}%`;
console.log(`cards ${total}; complete ${complete} (${pct(complete, total)}); derive identical ${same} (${pct(same, complete)} of complete)`);
console.log(`blocked: ${Object.entries(blockers).map(([k, v]) => `${k} ${v}`).join(", ")}`);
const n = (xs: [string, string[]][]) => xs.reduce((t, [, v]) => t + v.length, 0);
// Only a "grammar right" label switches a card; "grammar wrong" and "both wrong" keep the stored answer.
const right = labelled.filter(([k]) => triage.groups[k]!.label === "grammar right");
const guardedLabelled = guarded.filter((g) => right.some(([k]) => g.includes(`[${k}]`)));
console.log(`THE SWITCH: ${same + n(right) - guardedLabelled.length} cards derive from the printed text alone (${same} identical, ${n(right) - guardedLabelled.length} labelled "grammar right"; ${guardedLabelled.length} labelled but kept on the stored answer because the grammar would claim less)`);
for (const g of guardedLabelled.slice(0, Number(process.env.GUARDED ?? 0))) console.log(`   kept: ${g}`);
console.log(`labelled groups ${labelled.length} of ${sorted.length} (${n(labelled)} cards; not "grammar right": ${n(wrong)}); unlabelled ${n(sorted) - n(labelled)} cards`);
for (const [k, v] of sorted.filter(([k]) => !triage.groups[k]).slice(0, 25)) console.log(`${String(v.length).padStart(6)}  ${k}  e.g. ${v.slice(0, 3).join("; ")}`);
