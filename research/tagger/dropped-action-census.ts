/** WHICH CLAUSE VERBS DERIVE NOTHING — no effect kind and no emit — across the whole clause corpus.
 *  The measurement behind `derive/verb-accounting.test.ts` (roadmap AC8): every VERBS member must be
 *  EMITS, NOT AN EVENT (a rules reading) or OPEN with the card count printed here, and the OPEN
 *  counts are copied from this table. Free, read-only; re-run after any derive change.
 *
 *  Reads `deriveAbilities`'s own `unclaimed` list rather than re-deciding, so what this counts is
 *  exactly what the engine drops. Clause texts are reconstructed with `segment()` and used only
 *  when the stored and fresh segmentations agree on clause count (the known 3.3% id slide). */
import { connect, loadConfig } from "@edh-seer/data";
import { CLAUSES_COLLECTION, type CardClausesDoc } from "../../packages/tagger/src/clause-store.js";
import { deriveAbilities } from "../../packages/tagger/src/derive/derive.js";
import { segment } from "../../packages/tagger/src/segment.js";
import { TRIGGERS, VERBS } from "../../packages/tagger/src/normalize-prompt.js";
import { OPEN } from "../../packages/tagger/src/derive/verb-accounting.js";

const store = await connect(loadConfig());
const docs = await store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION).find({}).toArray();
type Row = { cards: Set<string>; actions: number; example: string };
const dropped = new Map<string, Row>();
let totalActions = 0, droppedActions = 0;
for (const d of docs) {
  const card = await store.cards.findOne({ _id: d.oracleId } as never, { projection: { name: 1, oracleText: 1, keywords: 1, typeLine: 1 } }) as unknown as
    { name: string; oracleText?: string; keywords?: string[]; typeLine?: string } | null;
  if (!card) continue;
  const fresh = segment(card.oracleText ?? "", card.keywords ?? [], card.typeLine ?? "");
  const texts: Record<number, string> = {};
  if (fresh.length === d.canonical.length) for (const c of fresh) texts[c.id] = c.text;
  totalActions += d.canonical.reduce((n, c) => n + (c.actions ?? []).filter((a) => a.verb !== "none").length, 0);
  const { unclaimed } = deriveAbilities(d.canonical, card.name, texts, undefined, card.oracleText);
  for (const a of unclaimed) {
    droppedActions++;
    const row = dropped.get(a.verb ?? "?") ?? { cards: new Set(), actions: 0, example: `${card.name}: ${a.verb} "${(a.object ?? "").slice(0, 50)}"` };
    row.cards.add(card.name); row.actions++;
    dropped.set(a.verb ?? "?", row);
  }
}
const triggerWords = new Set(TRIGGERS);
console.log(`clause docs ${docs.length} · actions ${totalActions} · dropped (no kind, no emit) ${droppedActions} (${(100 * droppedActions / totalActions).toFixed(1)}%)\n`);
console.log("verb                          cards  actions  trigger word?  example");
for (const [verb, r] of [...dropped].sort((a, b) => b[1].cards.size - a[1].cards.size)) {
  console.log(`${verb.padEnd(28)} ${String(r.cards.size).padStart(6)} ${String(r.actions).padStart(8)}  ${(triggerWords.has(verb) ? "yes" : "no").padEnd(13)}  ${r.example}`);
}
// THE RATCHET. An OPEN verb dropping MORE cards than the table records fails; fewer is printed so
// the table can be lowered. Verbs that are EMITS or NOT AN EVENT still drop in some contexts (an
// "enters tapped" tap, a self-leaving sacrifice) and are informational here.
const grew = Object.entries(OPEN).filter(([v, o]) => (dropped.get(v)?.cards.size ?? 0) > o.cards)
  .map(([v, o]) => `${v}: ${dropped.get(v)!.cards.size} > ${o.cards}`);
const shrank = Object.entries(OPEN).filter(([v, o]) => (dropped.get(v)?.cards.size ?? 0) < o.cards)
  .map(([v, o]) => `${v}: ${dropped.get(v)?.cards.size ?? 0} < ${o.cards}`);
if (shrank.length) console.log(`\nOPEN counts that SHRANK (lower the table): ${shrank.join(", ")}`);
if (grew.length) { console.log(`\nRATCHET FAILED — OPEN counts that GREW: ${grew.join(", ")}`); await store.close(); process.exit(1); }
console.log("\nratchet: ok — no OPEN verb drops more cards than verb-accounting.ts records");
const never = VERBS.filter((v) => v !== "none" && v !== "other" && !dropped.has(v));
console.log(`\nVERBS never dropped (${never.length}): ${never.join(", ")}`);
await store.close(); process.exit(0);
