/** CARDS THAT FORM NO EDGE AT ALL, ranked by whether they SHOULD. Free: Mongo reads only.
 *
 *  A card floating alone in a deck report is either honest (a Sol Ring in a deck with no artifact
 *  payoff really does relate to nothing pairwise) or a hole in derivation. The two are told apart by
 *  what the card DERIVES: an isolated card carrying a trigger or an emit is a dropped edge, because
 *  something in the deck almost certainly supplies or consumes it. An isolated card that derives
 *  nothing is either a vanilla body or a card whose text the pipeline never claimed — and
 *  `unclaimed`/`unknownTriggers` say which.
 *
 *  Ranked by DECK COUNT, so a card isolated in 29 of 71 decks outranks one isolated once.
 *
 *    npx tsx --env-file=packages/tagger/.env packages/matcher/src/bin/isolated-cards.ts [--all] */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections } from "@mtg/data";
import type { CardTags } from "@mtg/tagger";
import { ComboIndex } from "@mtg/engine";
import { analyzeDeckStructured, loadTokenTags } from "../index.js";
import type { DeckCard } from "../types.js";

const DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");
const SHOW_ALL = process.argv.includes("--all");
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const derived = store.db.collection<CardTags>("cardTagsDerived");
// TOKENS AS NODES (Task 6/7). Without this, `analyzeDeckStructured` builds zero token nodes and
// `report.edges` is silently the real-card-only view -- a token-mediated maker (Task 7) reads as
// isolated here even though its edge to the payoff survives two hops away, through a node this bin
// never built. Same wiring as `population-compare.ts`/`panel-score.ts`; measuring the population
// nothing ships is the exact `build-population.ts`-watching-flat-tags defect this repo already paid
// for once.
const tokenTags = await loadTokenTags(store.db);

interface Row {
  decks: number; land: boolean; trigger: boolean; emit: boolean; effect: boolean;
  untagged: boolean; unknownTriggers: string[]; unclaimed: number; oracle: string;
  /** Decks where this card's own verbs had a counterpart in the deck and it STILL formed no edge. */
  refused: number;
}
const isolated = new Map<string, Row>();
const seenIn = new Map<string, number>();
const counts = { land: [0, 0], nonland: [0, 0] };

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort()) {
  const sections = parseDecklistSections(readFileSync(join(DIR, file), "utf8"));
  const deck: DeckCard[] = [];
  const meta = new Map<string, { land: boolean; oracle: string; tags: CardTags | null }>();
  for (const name of [...sections.commanders, ...sections.deck]) {
    const doc = await lookup.findByName(normalizeName(name)) as unknown as
      { _id: string; name: string; typeLine?: string; oracleText?: string } | null;
    if (!doc) continue;
    const tags = (await derived.findOne({ oracleId: String(doc._id) })) as CardTags | null;
    meta.set(doc.name, { land: /Land/i.test(String(doc.typeLine ?? "")), oracle: String(doc.oracleText ?? ""), tags });
    deck.push({ card: docToCard(doc as never), tags });
  }
  const report = analyzeDeckStructured(deck, sections.commanders, undefined, undefined, new ComboIndex([]), undefined, tokenTags);
  // `e.a`/`e.b` are FACE names now (Task 7, faces-as-nodes split every multi-face card's edges
  // across its printed faces), and `meta` below is keyed on the doc's PHYSICAL name -- so filling
  // `connected` from the edge endpoints silently read every multi-face card as isolated, connected
  // or not. `Reason.producer`/`.consumer` name the physical card BY CONSTRUCTION (see
  // engine/synergy.ts's own doc comment: the face is a field, `producerFace`/`consumerFace`, never
  // folded into the name), so reading connectivity off the reasons instead of the edge pair is both
  // the cheap fix and the correct join. Review fix, 2026-08-27.
  const connected = new Set<string>();
  for (const e of report.edges) {
    for (const r of e.reasons) {
      if (r.producer) connected.add(r.producer);
      if (r.consumer) connected.add(r.consumer);
    }
  }

  // THE SUSPICIOUS SET. An isolated card whose VERB has a counterpart elsewhere in the same deck —
  // it emits `enters` and something there triggers on `enters` — was refused by a SUBJECT or a GATE,
  // not by the deck lacking a partner. That is where a real dropped edge lives. A card with no verb
  // counterpart at all is honestly alone and needs no explanation.
  const deckTriggerVerbs = new Set<string>();
  const deckEmitVerbs = new Set<string>();
  for (const d of deck) {
    for (const a of d.tags?.abilities ?? []) {
      for (const v of a.trigger?.verbs ?? []) deckTriggerVerbs.add(v);
      for (const e of a.emits ?? []) deckEmitVerbs.add(e.verb);
    }
  }

  for (const [name, m] of meta) {
    seenIn.set(name, (seenIn.get(name) ?? 0) + 1);
    const bucket = m.land ? counts.land : counts.nonland;
    bucket[0]++;
    if (connected.has(name)) continue;
    bucket[1]++;
    const abilities = m.tags?.abilities ?? [];
    // Does anything in this deck speak this card's verbs?
    const mine = { emits: new Set<string>(), triggers: new Set<string>() };
    for (const a of abilities) {
      for (const v of a.trigger?.verbs ?? []) mine.triggers.add(v);
      for (const e of a.emits ?? []) mine.emits.add(e.verb);
    }
    const hasCounterpart = [...mine.emits].some((v) => deckTriggerVerbs.has(v))
      || [...mine.triggers].some((v) => deckEmitVerbs.has(v));
    const r = isolated.get(name) ?? {
      decks: 0, land: m.land,
      trigger: abilities.some((a) => a.trigger !== undefined),
      emit: abilities.some((a) => (a.emits?.length ?? 0) > 0),
      effect: abilities.some((a) => a.effect.kind !== ""),
      untagged: m.tags === null,
      unknownTriggers: (m.tags as unknown as { unknownTriggers?: string[] })?.unknownTriggers ?? [],
      unclaimed: ((m.tags as unknown as { unclaimed?: unknown[] })?.unclaimed ?? []).length,
      oracle: m.oracle.replace(/\n/g, " | "),
      refused: 0,
    };
    r.decks++;
    if (hasCounterpart) r.refused++;
    isolated.set(name, r);
  }
}

const pct = (b: number[]) => `${b[1]} of ${b[0]} card-slots (${(100 * b[1] / b[0]).toFixed(1)}%)`;
console.log(`isolated LANDS    ${pct(counts.land)}`);
console.log(`isolated NONLANDS ${pct(counts.nonland)}`);

const rows = [...isolated.entries()];
const shouldHave = rows.filter(([, r]) => r.trigger || r.emit);
const noDerivation = rows.filter(([, r]) => !r.trigger && !r.emit && !r.effect);
console.log(`\ndistinct isolated cards: ${rows.length}`);
console.log(`  CARRYING A TRIGGER OR EMIT — something in the deck should feed them: ${shouldHave.length}`);
console.log(`  deriving an effect but no trigger/emit (a static with no reachable subject): ${rows.length - shouldHave.length - noDerivation.length}`);
console.log(`  deriving nothing at all: ${noDerivation.length} (of which untagged: ${noDerivation.filter(([, r]) => r.untagged).length})`);

const suspicious = shouldHave.filter(([, r]) => r.refused > 0);
console.log(`  ...of which the deck DID speak their verbs and no edge formed anyway: ${suspicious.length}`);
console.log(`\nthe ones that should not be floating, by decks where a verb counterpart existed:`);
for (const [n, r] of suspicious.sort((a, b) => b[1].refused - a[1].refused).slice(0, SHOW_ALL ? 999 : 18)) {
  const flags = [r.trigger ? "trigger" : "", r.emit ? "emit" : "", r.land ? "land" : ""].filter(Boolean).join(",");
  console.log(`  ${String(r.refused).padStart(3)}/${String(r.decks).padStart(2)} decks  ${n.slice(0, 32).padEnd(34)} [${flags}]`
    + (r.unknownTriggers.length ? `  unknownTriggers=${JSON.stringify(r.unknownTriggers)}` : "")
    + (r.unclaimed ? `  unclaimed=${r.unclaimed}` : ""));
  console.log(`            ${r.oracle.slice(0, 150)}`);
}
await store.close();
