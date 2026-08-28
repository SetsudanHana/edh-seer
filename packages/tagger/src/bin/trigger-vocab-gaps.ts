/** What the clause layer NEEDED to say and could not.
 *
 *  Two demand signals, both free and both measured rather than guessed:
 *   1. stored trigger clauses that answered `other` — the escape hatch firing, one row per card;
 *   2. stored trigger events that no engine VERB maps to — spellable by the prompt, invisible to the
 *      matcher, so they surface in `unknownTriggers` and form no edges.
 *
 *  Ranked by CARDS, and each row prints the clause text, because "count the consumers, not the
 *  printed cards" cuts both ways: a word worth adding is one several cards actually reach for. */
import { connect, loadConfig } from "@edh-seer/data";
import { CLAUSES_COLLECTION, type CardClausesDoc } from "../clause-store.js";
import { TRIGGERS } from "../normalize-prompt.js";
import { normalizeTriggerVerb } from "../derive/derive.js";
import { segment } from "../segment.js";

const store = await connect(loadConfig());

/** derive.ts's OWN normalizer, imported rather than re-implemented. A first cut of this bin rebuilt
 *  it from VERB_ALIASES and missed `CLAUSE_TRIGGER_TO_VERB`, which maps sacrificed/discarded/milled/
 *  life-gained/life-lost — reporting 49 unmatchable clauses that match perfectly well. */
const toVerb = (event: string): string | undefined => normalizeTriggerVerb(event) ?? undefined;

/** When the stored and fresh segmentations disagree on clause count the ids slide, so a per-clause
 *  text cannot be trusted. The card's own trigger LINES still can — they just do not say which
 *  clause is which, which is enough to read what word the card needed. */
const triggerLines = (t: string): string =>
  t.split("\n").filter((l) => /^(when|whenever|at the beginning)/i.test(l.trim())).join(" / ");

const docs = await store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION).find({}).toArray();

const otherRows: { name: string; text: string }[] = [];
const unmatchable = new Map<string, { name: string; text: string }[]>();

for (const d of docs) {
  const card = await store.cards.findOne({ _id: d.oracleId } as never) as unknown as
    { name: string; oracleText?: string; keywords?: string[]; typeLine?: string } | null;
  const fresh = segment(card?.oracleText ?? "", card?.keywords ?? [], card?.typeLine ?? "");
  const texts: Record<number, string> = {};
  // Only trust reconstructed text when the two segmentations agree on clause count — the known
  // 3.3% id-slide, documented in the resource-ledger spec.
  if (fresh.length === d.canonical.length) for (const c of fresh) texts[c.id] = c.text;

  for (const c of d.canonical) {
    const event = c.trigger?.event;
    if (!event || event === "none") continue;
    const text = (texts[c.id] ?? triggerLines(card?.oracleText ?? "")).slice(0, 150);
    if (event === "other") { otherRows.push({ name: card?.name ?? "?", text }); continue; }
    if (toVerb(event)) continue;
    unmatchable.set(event, [...(unmatchable.get(event) ?? []), { name: card?.name ?? "?", text }]);
  }
}

console.log(`=== 1. TRIGGER CLAUSES THAT ANSWERED \`other\` — the prompt had no word (${otherRows.length}) ===\n`);
for (const r of otherRows) console.log(`  ${r.name}\n     ${r.text || "(no trigger line found)"}`);

console.log(`\n=== 2. SPELLABLE BUT UNMATCHABLE — in TRIGGERS, mapped to no engine verb ===\n`);
for (const [event, rows] of [...unmatchable].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(rows.length).padStart(3)}x  ${event}`);
  for (const r of rows.slice(0, 3)) console.log(`         ${r.name}: ${r.text.slice(0, 110)}`);
}

console.log(`\n=== 3. THE TWO VOCABULARIES ===`);
console.log(`  TRIGGERS (${TRIGGERS.length}): ${TRIGGERS.join(", ")}`);
const unmapped = TRIGGERS.filter((t) => t !== "none" && t !== "other" && !toVerb(t));
console.log(`\n  of those, mapping to NO engine verb (${unmapped.length}): ${unmapped.join(", ")}`);

await store.close();
process.exit(0);
