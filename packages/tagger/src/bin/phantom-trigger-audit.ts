/** Stored clauses whose TRIGGER EVENT has no cue anywhere in the card's oracle text — i.e. the
 *  normalizer invented it. Free, read-only; the fix is money (`normalize-corpus.ts --refresh-other`),
 *  so measure before spending.
 *
 *  Found via Grim Guardian, whose printed text is one constellation ETB trigger and whose stored
 *  clauses carry a SECOND ability triggering on `dies` — which then claimed every enchantment death
 *  in its deck. A hallucinated clause is the worst defect this pipeline can produce: everything
 *  downstream is deterministic and will faithfully propagate it.
 *
 *  The test is deliberately GENEROUS — one cue anywhere in the card's text clears the whole card, so
 *  this under-reports and never invents a defect. Verbs whose cue is unwritable (`cast` is implied
 *  for every nonland, phase triggers are structural) are skipped rather than guessed at. */
import { connect, loadConfig } from "@mtg/data";
import { CLAUSES_COLLECTION, hasPhantomTrigger, type CardClausesDoc } from "../clause-store.js";

const store = await connect(loadConfig());

const docs = await store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION).find({}).toArray();
let checked = 0;
const bad: { name: string; event: string; subject: string; version?: number; text: string }[] = [];
for (const d of docs) {
  const card = await store.cards.findOne({ _id: d.oracleId } as never) as unknown as
    { name: string; oracleText?: string } | null;
  const text = card?.oracleText ?? "";
  if (!text) continue;
  if (d.canonical.some((c) => c.trigger?.event)) checked++;
  if (!hasPhantomTrigger(d, text)) continue;
  // The predicate is card-level; re-walk the clauses to name WHICH trigger has no cue.
  for (const c of d.canonical) {
    if (!c.trigger?.event) continue;
    if (!hasPhantomTrigger({ ...d, canonical: [c] }, text)) continue;
    bad.push({ name: card?.name ?? "?", event: c.trigger.event, subject: String(c.trigger?.subject ?? ""),
      version: (d as unknown as { normalizeVersion?: number }).normalizeVersion, text: text.replace(/\n/g, " | ") });
  }
}

console.log(`cards carrying a checkable trigger clause: ${checked} of ${docs.length}`);
console.log(`clauses whose event has NO cue in the card's own text: ${bad.length} over ${new Set(bad.map((b) => b.name)).size} cards\n`);
const byEvent = new Map<string, number>();
for (const b of bad) byEvent.set(b.event, (byEvent.get(b.event) ?? 0) + 1);
for (const [e, n] of [...byEvent].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${e}`);
console.log();
for (const b of bad) console.log(`  ${b.name} [v${b.version}] trigger=${b.event} subject="${b.subject}"\n     ${b.text.slice(0, 160)}`);

await store.close();
process.exit(0);
