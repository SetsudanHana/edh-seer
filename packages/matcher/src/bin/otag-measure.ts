import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig, mongoLookup, normalizeName, docToCard, parseDecklistText } from "@edh-seer/data";
import { loadOtagSemantics } from "@edh-seer/tagger";
import type { CardTags, Verb } from "@edh-seer/tagger";
import type { Reason } from "@edh-seer/engine";
import { loadHierarchy, pairReasons } from "../index.js";
import { producerEvents } from "../edges.js";
import { normalizeZoneEvent } from "../zones.js";
import type { DeckCard } from "../types.js";
import { buildOtagEdges, pairKey, undirectedPairs } from "../otag-edges.js";
import type { GoldPair } from "./eval-pairs-core.js";
import { edhrecPairSet, seededRandom } from "./edhrec-pairs.js";

const DECK_DIR = new URL("../../../cli/decks/", import.meta.url).pathname;

const DECKS = JSON.parse(
  readFileSync(new URL("../calibration-decks.json", import.meta.url), "utf8"),
) as Array<{ name: string; path: string; saltId: string }>;

const GOLD = JSON.parse(
  readFileSync(new URL("../goldpairs.json", import.meta.url), "utf8"),
) as GoldPair[];

interface Loaded {
  name: string;
  cards: DeckCard[];
  otagsByCard: Map<string, string[]>;
}

/** True when the producer's structured tags emit verb V -- mirroring the engine's own
 *  producer-event derivation, including structurally implied cast/enters events, so this is
 *  apples-to-apples with pairReasons.
 *
 *  The otag verb (e.g. "dies") is normalized the same way producerEvents normalizes emits (e.g.
 *  to "leaves") before comparing -- producerEvents runs every emit through normalizeZoneEvent, so
 *  a raw string match against the un-normalized otag verb would silently go blind on every verb
 *  normalizeZoneEvent rewrites (dies -> leaves is the only one reachable from OTAG_EVENT_TO_VERB's
 *  range today). Subject is a throwaway stub: only .verb of the normalized result is used. */
function producerHasVerb(p: DeckCard, verb: string): boolean {
  if (!p.tags) return false;
  const producerVerb = normalizeZoneEvent({ verb: verb as Verb, subject: { control: "you", token: null } }).verb;
  return producerEvents(p.tags).some((e) => e.verb === producerVerb);
}

/** True when the consumer's structured tags trigger on the raw (un-normalized) verb V. */
function consumerHasVerb(c: DeckCard, verb: string): boolean {
  if (!c.tags) return false;
  return c.tags.abilities.some((a) => ((a.trigger?.verbs ?? []) as readonly string[]).includes(verb));
}

/** True when both cards carry verb V in their structured tags -- producer emits it, consumer
 *  triggers on it. If the engine still rejected the pair, subject matching is what rejected it. */
function verbPresentInTags(p: DeckCard, c: DeckCard, verb: string): boolean {
  return producerHasVerb(p, verb) && consumerHasVerb(c, verb);
}

/** The verb an engine Reason's tag encodes, e.g. "dies:creature" -> "dies", "static:anthem" ->
 *  "static". zoneEventKey already emits legacy verb spellings (dies, enters, enters-graveyard,
 *  cast, ...) that line up with OTAG_EVENT_TO_VERB's Verb strings, so the prefix IS the verb --
 *  no re-normalization needed. Non-event reasons (static:*, graveyard-recursion:*) fall through
 *  as their own "verb", which never matches a real otag verb and so never over-counts. */
function reasonVerb(tag: string): string {
  return tag.split(":")[0]!;
}

async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const cardTags = store.db.collection("cardTags");
  const cardOtags = store.db.collection("cardOtags");
  const hierarchy = loadHierarchy();
  const semantics = loadOtagSemantics();

  // ---- load decks -------------------------------------------------------
  const loaded: Loaded[] = [];
  for (const d of DECKS) {
    const cards: DeckCard[] = [];
    const otagsByCard = new Map<string, string[]>();
    for (const name of parseDecklistText(readFileSync(join(DECK_DIR, d.path), "utf8"))) {
      const doc = await lookup.findByName(normalizeName(name));
      if (!doc) continue;
      const tags = (await cardTags.findOne({ oracleId: doc._id })) as CardTags | null;
      const card = docToCard(doc as never);
      cards.push({ card, tags });
      const od = (await cardOtags.findOne({ _id: doc._id } as never)) as { otags?: string[] } | null;
      otagsByCard.set(card.name, od?.otags ?? []);
    }
    if (!cards.length) throw new Error(`deck "${d.name}" resolved zero cards -- wrong corpus?`);
    loaded.push({ name: d.name, cards, otagsByCard });
  }

  // ---- M1: floor test against the 55 verified gold pairs -----------------
  // Each gold pair is judged on its own two cards, not inside a deck.
  let goldHit = 0;
  let goldTotal = 0;
  const goldMisses: string[] = [];
  for (const g of GOLD) {
    if (!g.verified) continue;
    const da = await lookup.findByName(normalizeName(g.a));
    const db = await lookup.findByName(normalizeName(g.b));
    if (!da || !db) continue;
    goldTotal++;
    const oa = ((await cardOtags.findOne({ _id: da._id } as never)) as { otags?: string[] } | null)?.otags ?? [];
    const ob = ((await cardOtags.findOne({ _id: db._id } as never)) as { otags?: string[] } | null)?.otags ?? [];
    const edges = buildOtagEdges([g.a, g.b], new Map([[g.a, oa], [g.b, ob]]), semantics);
    if (edges.length) goldHit++;
    else goldMisses.push(`${g.a} / ${g.b} (${g.category})`);
  }
  console.log(`=== M1: otag edges vs verified gold pairs ===`);
  console.log(`  ${goldHit}/${goldTotal} (${((100 * goldHit) / goldTotal).toFixed(0)}%)`);
  console.log(`  NOTE: a low number here is informative, not a failure -- many gold pairs rely`);
  console.log(`  on a structural producer this model deliberately excludes.`);
  if (goldMisses.length) {
    console.log(`  missed:`);
    for (const m of goldMisses) console.log(`    ${m}`);
  }

  // ---- M2: reproduction against the engine ------------------------------
  console.log(`\n=== M2: reproduction vs engine edges ===`);
  console.log(`  recall    = otag∩engine / engine  (share of engine edges otags reproduce)`);
  console.log(`  agreement = otag∩engine / otag  (share of otag edges the engine confirms)\n`);
  console.log(`  ${"deck".padEnd(12)} ${"engine".padStart(7)} ${"otag".padStart(7)} ${"both".padStart(7)} ${"recall".padStart(8)} ${"agree".padStart(8)}`);

  const perVerb = new Map<string, { otag: number; both: number; bothVerb: number }>();
  const m3 = { otagOnly: [] as string[], confirmed: [] as string[], random: [] as string[] };
  let rejected = 0;
  let rejectedSubjectOnly = 0;
  let rejectedUntagged = 0;
  // The "verb absent from tags" bucket, split by which side (if either) actually carries the
  // verb -- see FIX 1: 87% of that bucket is a role/direction disagreement, not a blank slate.
  let verbAbsentConsumerOnly = 0; // engine has it as a consumer trigger; producer emit missing
  let verbAbsentProducerOnly = 0; // engine has it as a producer emit; consumer trigger missing
  let verbAbsentNeither = 0; // no record on either side -- the only true "no signal at all" case
  for (const l of loaded) {
    // Dedupe: decklists repeat basic lands (and, e.g., samut has two entries that resolve to the
    // same card name). buildOtagEdges iterates the raw names array with no index-uniqueness, so a
    // repeated name would multiply that card's edges in the per-verb counts below.
    const names = [...new Set(l.cards.map((c) => c.card.name))];
    const otagEdges = buildOtagEdges(names, l.otagsByCard, semantics);
    const otagSet = undirectedPairs(otagEdges);

    const engineSet = new Set<string>();
    // Keeps the actual Reason[] per confirmed pair (not just the boolean membership in
    // engineSet) so the per-verb loop below can tell "the engine linked this pair for ANY
    // reason" apart from "the engine linked this pair FOR THIS VERB" -- see FIX 2.
    const engineReasons = new Map<string, Reason[]>();
    for (let i = 0; i < l.cards.length; i++) {
      for (let j = i + 1; j < l.cards.length; j++) {
        // Same guard as buildOtagEdges's a===b skip: two decklist slots that resolved to the same
        // card name must not be compared to themselves, or a self-referential ability (e.g. a
        // static effect matching its own card) creates a spurious "X|X" self-loop in engineSet.
        if (l.cards[i].card.name === l.cards[j].card.name) continue;
        const reasons = pairReasons(l.cards[i], l.cards[j], hierarchy);
        if (reasons.length) {
          const key = pairKey(l.cards[i].card.name, l.cards[j].card.name);
          engineSet.add(key);
          engineReasons.set(key, reasons);
        }
      }
    }
    const both = [...otagSet].filter((k) => engineSet.has(k)).length;
    const recall = engineSet.size ? (100 * both) / engineSet.size : 0;
    const agree = otagSet.size ? (100 * both) / otagSet.size : 0;
    console.log(
      `  ${l.name.padEnd(12)} ${String(engineSet.size).padStart(7)} ${String(otagSet.size).padStart(7)} ` +
        `${String(both).padStart(7)} ${recall.toFixed(0).padStart(7)}% ${agree.toFixed(0).padStart(7)}%`,
    );

    for (const e of otagEdges) {
      const r = perVerb.get(e.verb) ?? { otag: 0, both: 0, bothVerb: 0 };
      r.otag++;
      const key = pairKey(e.a, e.b);
      const reasons = engineReasons.get(key);
      if (reasons) {
        r.both++;
        if (reasons.some((rr) => reasonVerb(rr.tag) === e.verb)) r.bothVerb++;
      }
      perVerb.set(e.verb, r);

      if (!engineSet.has(key)) {
        rejected++;
        const p = l.cards.find((c) => c.card.name === e.a);
        const c = l.cards.find((x) => x.card.name === e.b);
        if (!p?.tags || !c?.tags) {
          rejectedUntagged++;
        } else if (verbPresentInTags(p, c, e.verb)) {
          rejectedSubjectOnly++;
        } else {
          const producerHas = producerHasVerb(p, e.verb);
          const consumerHas = consumerHasVerb(c, e.verb);
          if (consumerHas && !producerHas) verbAbsentConsumerOnly++;
          else if (producerHas && !consumerHas) verbAbsentProducerOnly++;
          else verbAbsentNeither++;
        }
      }
    }

    // m3.otagOnly is every rejected otag PAIR (deduped, undirected), not the 323 verb-absent
    // EDGES isolated above -- it also folds in the 112 subject-mismatch pairs, and a pair can
    // carry more than one rejected edge (verb), so this is a different set on a different unit.
    // M3 does not measure the 323 in isolation; there is no isolated M3 run over just that set.
    const otagOnly = [...otagSet].filter((k) => !engineSet.has(k));
    const confirmed = [...otagSet].filter((k) => engineSet.has(k));
    m3.otagOnly.push(...otagOnly);
    m3.confirmed.push(...confirmed);
    // Null: same count as otagOnly, drawn from pairs in neither measured set, fixed seed.
    const rnd = seededRandom(42);
    const candidates: string[] = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const k = pairKey(names[i], names[j]);
        if (!otagSet.has(k) && !engineSet.has(k)) candidates.push(k);
      }
    }
    for (let n = 0; n < otagOnly.length && candidates.length; n++) {
      m3.random.push(candidates[Math.floor(rnd() * candidates.length)]);
    }
  }

  // pair-level = engine linked {a,b} for ANY reason. verb-specific = engine linked {a,b} FOR
  // THIS VERB (a Reason whose tag decodes to the same verb). The two diverge a lot -- see FIX 2.
  console.log(`\n  per-verb agreement:`);
  console.log(`    ${"verb".padEnd(20)} ${"pair-level (any reason)".padStart(26)}   ${"verb-specific (same verb)".padStart(26)}`);
  let totalOtag = 0, totalBoth = 0, totalBothVerb = 0;
  for (const [verb, r] of [...perVerb].sort((a, b) => b[1].otag - a[1].otag)) {
    totalOtag += r.otag; totalBoth += r.both; totalBothVerb += r.bothVerb;
    const pairCell = `${r.both}/${r.otag}`.padStart(10) + ` ${((100 * r.both) / r.otag).toFixed(0).padStart(3)}%`;
    const verbCell = `${r.bothVerb}/${r.otag}`.padStart(10) + ` ${((100 * r.bothVerb) / r.otag).toFixed(0).padStart(3)}%`;
    console.log(`    ${verb.padEnd(20)} ${pairCell.padStart(26)}   ${verbCell.padStart(26)}`);
  }
  const totalPairCell = `${totalBoth}/${totalOtag}`.padStart(10) + ` ${((100 * totalBoth) / totalOtag).toFixed(0).padStart(3)}%`;
  const totalVerbCell = `${totalBothVerb}/${totalOtag}`.padStart(10) + ` ${((100 * totalBothVerb) / totalOtag).toFixed(0).padStart(3)}%`;
  console.log(`    ${"overall".padEnd(20)} ${totalPairCell.padStart(26)}   ${totalVerbCell.padStart(26)}`);

  console.log(`\n  why the engine rejected otag edges (${rejected} rejected edges):`);
  const pct = (n: number) => (rejected ? ((100 * n) / rejected).toFixed(0) : "0");
  const verbAbsentTotal = rejected - rejectedSubjectOnly - rejectedUntagged;
  const pctOfAbsent = (n: number) => (verbAbsentTotal ? ((100 * n) / verbAbsentTotal).toFixed(0) : "0");
  console.log(`    subject mismatch only:  ${rejectedSubjectOnly} (${pct(rejectedSubjectOnly)}%) -- same verb both sides, engine rejected on subject`);
  console.log(`    a side was untagged:    ${rejectedUntagged} (${pct(rejectedUntagged)}%)`);
  console.log(`    verb absent from tags:  ${verbAbsentTotal} (${pct(verbAbsentTotal)}%) -- split by which side (if either) carries the verb:`);
  console.log(`      consumer has it, producer emit missing: ${verbAbsentConsumerOnly} (${pctOfAbsent(verbAbsentConsumerOnly)}% of this bucket)`);
  console.log(`      producer has it, consumer trigger missing: ${verbAbsentProducerOnly} (${pctOfAbsent(verbAbsentProducerOnly)}% of this bucket)`);
  console.log(`      neither side has it -- true candidate new edge: ${verbAbsentNeither} (${pctOfAbsent(verbAbsentNeither)}% of this bucket)`);

  console.log(`\n=== M3: EDHREC agreement (otag-only edges are the deliverable) ===`);
  const edh = await edhrecPairSet();
  if (!edh) {
    console.log(`  M3 unavailable -- EDHREC could not be reached. M1 and M2 above are unaffected.`);
  } else {
    const rate = (keys: string[]) => {
      if (!keys.length) return "n/a";
      const hits = keys.filter((k) => {
        const [a, b] = k.split("|");
        return edh.has(pairKey(normalizeName(a), normalizeName(b)));
      }).length;
      return `${hits}/${keys.length} (${((100 * hits) / keys.length).toFixed(0)}%)`;
    };
    console.log(`  otag-only edges (under test):   ${rate(m3.otagOnly)}`);
    console.log(`  otag∩engine edges (positive):   ${rate(m3.confirmed)}`);
    console.log(`  random deck pairs (null):       ${rate(m3.random)}`);
    console.log(`\n  Read the COMPARISON, not the absolute numbers. EDHREC co-occurrence means both`);
    console.log(`  cards suit an archetype, not that they synergize with each other, so the rate is`);
    console.log(`  only meaningful against the positive control and the null.`);
  }

  await store.close();
}

main().catch((err) => {
  console.error("otag-measure failed:", err);
  process.exit(1);
});
