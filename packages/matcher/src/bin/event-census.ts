import { connect, loadConfig } from "@edh-seer/data";
import type { CardTags } from "@edh-seer/tagger";
import { buildCensus, type CensusRow } from "../census.js";
import { loadHierarchy } from "../hierarchy.js";

/** Corpus-wide event census: for every event key, how many cards sit on each side of it and how
 *  much of the other side actually matches under the engine's own rules.
 *
 *  Answers "what does the corpus have, and what is it missing" without materializing any
 *  card-to-card graph. That graph is ~10^7 edges (one key, `enters:any`, is 6.3M of them on its
 *  own); the card <-> event-key incidence this reads is ~7*10^4 rows, and card-to-card edges are
 *  a join through it. Deck analysis is that join restricted to 100 cards.
 *
 *  Usage: npx tsx packages/matcher/src/bin/event-census.ts [--top N] */
const TOP = Number(process.argv[process.argv.indexOf("--top") + 1]) || 15;

const table = (title: string, rows: CensusRow[], selfLabel: string, otherLabel: string): void => {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  console.log(`  ${"event key".padEnd(44)} ${selfLabel.padStart(9)} ${otherLabel.padStart(9)} ${"shapes".padStart(6)}`);
  for (const r of rows) {
    console.log(`  ${r.key.padEnd(44)} ${String(r.cards).padStart(9)} ${String(r.counterpart).padStart(9)} ${String(r.shapes).padStart(6)}`);
  }
};

async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const tags = store.db.collection("cardTags");
  const cards: CardTags[] = [];
  for await (const doc of tags.find({}) as AsyncIterable<CardTags>) cards.push(doc);

  const census = buildCensus(cards, loadHierarchy());
  const keys = new Set([...census.consumers, ...census.producers].map((r) => r.key));
  const holes = census.consumers.filter((r) => r.counterpart === 0 && !r.selfSupplied);
  const selfSupplied = census.consumers.filter((r) => r.selfSupplied);
  // Only authored emits can indicate an extraction problem; a derived event with no listener is a
  // fact about Magic (nothing pays off Spirits attacking) rather than a pipeline bug.
  const dead = census.producers.filter((r) => r.counterpart === 0 && r.authored);
  const derivedUnused = census.producers.filter((r) => r.counterpart === 0 && !r.authored);

  console.log(`=== corpus event census (${census.cards} tagged cards, ${keys.size} distinct event keys) ===`);
  console.log(`counterpart counts respect subsumption: a specific producer supplies a general consumer.`);
  console.log(`\n  consumer keys: ${census.consumers.length}  (${holes.length} with ZERO supply, ${selfSupplied.length} self-supplied by design)`);
  console.log(`  producer keys: ${census.producers.length}  (${dead.length} authored emits matched by NO trigger; ${derivedUnused.length} derived keys unused, expected)`);

  // Per-verb rollup: a whole verb family can be starved while every individual key looks like a
  // small tail row (attacks:dragon, attacks:samurai, ... each a handful of listeners). Ratio, not
  // key count, is what says "this verb is unmodelled".
  const verbOf = (key: string): string => (key.startsWith("dies:") ? "dies" : key.split(":")[0]);
  const perVerb = new Map<string, { listeners: number; suppliers: number }>();
  for (const r of census.consumers) {
    const v = perVerb.get(verbOf(r.key)) ?? { listeners: 0, suppliers: 0 };
    v.listeners += r.cards;
    v.suppliers += r.counterpart;
    perVerb.set(verbOf(r.key), v);
  }
  console.log(`\nPER-VERB supply ratio (summed over that verb's consumer keys; low = starved):`);
  console.log(`  ${"verb".padEnd(22)} ${"listeners".padStart(9)} ${"suppliers".padStart(9)} ${"ratio".padStart(7)}`);
  for (const [verb, v] of [...perVerb].sort((a, b) => a[1].suppliers / a[1].listeners - b[1].suppliers / b[1].listeners)) {
    console.log(`  ${verb.padEnd(22)} ${String(v.listeners).padStart(9)} ${String(v.suppliers).padStart(9)} ${(v.suppliers / v.listeners).toFixed(2).padStart(7)}`);
  }

  table(
    `SUPPLY HOLES -- cards listen for this, nothing emits anything that matches (top ${TOP} by listeners):`,
    holes.slice(0, TOP), "listeners", "suppliers",
  );
  table(
    `DEAD EMISSIONS -- the tagger AUTHORED this emit, no trigger in the corpus matches it (top ${TOP} by emitters):`,
    dead.slice(0, TOP), "emitters", "listeners",
  );
  // Suppliers here are NOT zero and should not be: the implied "any creature attacks" event forms no
  // edge, but a card that AUTHORS the event (goad, Mage Slayer) genuinely supplies it. A row marked
  // `(narrowed)` is the opposite case -- it filters on which creature, so implied events do reach it.
  table(
    `SELF-SUPPLIED -- normal game actions; the implied event forms no edge, so any suppliers shown are cards that AUTHOR it (top ${TOP}):`,
    selfSupplied.slice(0, TOP), "listeners", "authored suppliers",
  );
  table(
    `SATURATED -- both sides dense, so the edge carries little information (top ${TOP} by listeners):`,
    census.consumers.filter((r) => r.counterpart > 0).slice(0, TOP), "listeners", "suppliers",
  );

  await store.close();
}

main().catch((err) => {
  console.error("event-census failed:", err);
  process.exit(1);
});
