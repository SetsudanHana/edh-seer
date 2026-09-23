/** DECK SUGGESTIONS IN THE BROWSER (spec docs/superpowers/specs/2026-09-24-deck-suggestions-design.md,
 *  roadmap AO3): every finding a card can fix names the cards that fix it.
 *
 *  Lazily imported by the client after the report renders, like `api.static.ts`, and fed from the
 *  same static artifacts. The candidate pool is each deck card's `pi` (partner positions riding in
 *  the `cards/` shards the report already prefetched), ranked by `suggest.ts`.
 *
 *  THE ENGINE HAS THE LAST WORD. Every row shown carries reasons from `directedReasons`, asked the
 *  way a card page asks it (a pair, no token nodes). A pool candidate the live engine draws nothing for is DROPPED --
 *  only a stale artifact produces one, and a card with no reason under it is a claim with nothing
 *  behind it. Unmet-demand candidates, which come from an over-collecting key filter, are shown only
 *  when the engine finds a reason from them to a deck card. */
import type { DeckReport } from "@edh-seer/engine";
import { docToCard } from "@edh-seer/data/docs";
import { normalizeName } from "@edh-seer/data/names";
import { StaticLookup } from "./static-lookup.js";
import { directedReasons } from "./edges.js";
import { loadHierarchy } from "./hierarchy.js";
import { BUILD_CATEGORIES, BUILD_PARENTS } from "./build.js";
import { POOL_CLASSES } from "./answer-pool.js";
import {
  answerList, byConnection, candidatePool, gapList, pairReplacements, planList,
  type Candidate, type CutSide, type DeckSide, type GroupState, type IndexCard,
} from "./suggest.js";
import { eventKeysForDemand } from "./suggest-keys.js";
import type { DeckCard } from "./types.js";

export interface SuggestedCard {
  name: string;
  slug: string;
  identity: string[];
  mv: number;
  /** Deck cards the engine drew a reason with, strongest first. */
  connections: string[];
  /** The engine's own sentences, deduplicated, in connection order. */
  reasons: string[];
  /** Also qualifies for "Strengthen what works", shown here instead (one card, one place). */
  alsoPlan?: true;
}
export interface SuggestedPair {
  cut: string;
  add: SuggestedCard;
  rule: "cross-job" | "same-job" | "no-role";
  counts: { group: string; from: number; to: number }[];
  cutConnections: number;
}
export interface DeckSuggestions {
  /** Keyed by `buildParents[].name` ("Interaction"). */
  build: Record<string, SuggestedCard[]>;
  /** Keyed by `deckMath.answers[].class` ("enchantment"). */
  answers: Record<string, SuggestedCard[]>;
  /** Keyed by `deckMath.demand[].key`. */
  synergy: Record<string, SuggestedCard[]>;
  plan: SuggestedCard[];
  pairs: SuggestedPair[];
}

const PLAN_LIMIT = 8;
/** Extra slots on a finding's list, per spec §2 ("the missing slots plus 2"). */
const SPARES = 2;
/** Unmet-demand candidates taken to verification per key. */
const SYNERGY_LIMIT = 10;
/** A band no card falls outside, for a group `BUILD_PARENTS` does not know. */
const ANY_BAND: readonly [number, number] = [0, Infinity];

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** The name index, decoded into what `suggest.ts` ranks on. */
async function decodeIndex(lookup: StaticLookup): Promise<IndexCard[]> {
  const [rows, vocab] = await Promise.all([lookup.nameIndex(), lookup.nameIndexVocabulary()]);
  const land = vocab.types.indexOf("land");
  return rows.map((row, pos) => ({
    pos, name: row.name, slug: row.slug, identity: row.identity, mv: row.mv ?? 0,
    isLand: land >= 0 && (row.t ?? []).includes(land),
    roles: (row.r ?? []).map((i) => BUILD_CATEGORIES[i]!).filter(Boolean),
    answers: (row.a ?? []).map((i) => POOL_CLASSES[i]!).filter(Boolean),
  }));
}

/** The engine's view of a card, built the way `build-static.ts` builds the partner corpus. */
function deckCards(lookup: StaticLookup): (name: string) => Promise<DeckCard | null> {
  const cache = new Map<string, Promise<DeckCard | null>>();
  return (name) => {
    let p = cache.get(name);
    if (!p) {
      p = (async () => {
        const doc = await lookup.findByName(normalizeName(name));
        if (!doc) return null;
        const tags = await lookup.findOne(doc._id);
        return { card: { ...doc, ...docToCard(doc) } as DeckCard["card"], tags };
      })();
      cache.set(name, p);
    }
    return p;
  };
}

type Verify = (candidate: IndexCard, against: readonly string[], producerOnly: boolean) => Promise<SuggestedCard | null>;

/** Run the engine on (deck card, candidate) in both directions -- or candidate -> deck card only,
 *  for an unmet demand the candidate must SUPPLY -- and keep the deck cards it draws a reason with. */
function verifier(dc: (name: string) => Promise<DeckCard | null>): Verify {
  const h = loadHierarchy();
  // NO TOKEN NODE EXISTS HERE, exactly as on a card page: the report drops a maker's direct "a token
  // enters" edge for the two-hop path through the token node, and a suggestion has no node to carry
  // that hop -- so ask the way `partners-core` asks, or every token maker's partner reads as stale.
  const opts = { tokensMediate: false };
  return async (candidate, against, producerOnly) => {
    const y = await dc(candidate.name);
    if (!y) return null;
    const connections: string[] = [];
    const reasons: string[] = [];
    for (const name of against) {
      const x = await dc(name);
      if (!x) continue;
      const found = producerOnly
        ? directedReasons(y, x, h, opts)
        : [...directedReasons(x, y, h, opts), ...directedReasons(y, x, h, opts)];
      if (found.length === 0) continue;
      connections.push(name);
      for (const r of found) if (!reasons.includes(r.text)) reasons.push(r.text);
    }
    if (connections.length === 0) return null;
    return { name: candidate.name, slug: candidate.slug, identity: candidate.identity, mv: candidate.mv, connections, reasons };
  };
}

/** Verify a ranked list and keep the first `limit` the engine agrees with. A pool candidate it does
 *  not agree with is a stale pair, and is said so in the console rather than shown. */
async function verified(list: readonly Candidate[], limit: number, verify: Verify): Promise<SuggestedCard[]> {
  const out: SuggestedCard[] = [];
  for (const c of list) {
    if (out.length >= limit) break;
    const s = await verify(c.card, c.connections.map((x) => x.deckCard), false);
    if (s) out.push(s);
    else console.warn("[suggest] stale pair: the engine draws nothing for", c.card.name);
  }
  return out;
}

/** The build groups as `pairReplacements` needs them: the report's counts, `BUILD_PARENTS`' bands. */
function groupsOf(report: DeckReport): GroupState[] {
  return (report.buildParents ?? []).map((p) => ({
    name: p.name, count: p.count, target: p.target, leaves: p.leaves,
    costBand: BUILD_PARENTS.find((b) => b.name === p.name)?.costBand ?? ANY_BAND,
  }));
}

export async function suggestForDeck(input: {
  report: DeckReport;
  commanderColorIdentity: string[];
  baseUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<DeckSuggestions> {
  const { report } = input;
  const lookup = new StaticLookup(input.baseUrl, input.fetchImpl);
  // PHYSICAL NAMES: a two-faced card rates one row per face, and both faces are one card in the deck.
  const physical = unique(report.cards.filter((c) => !c.isCompanion).map((c) => c.cardName ?? c.name));
  await lookup.prefetch(physical.map(normalizeName));
  const index = await decodeIndex(lookup);
  const atName = new Map(index.map((c) => [c.name, c] as const));

  const pi = new Map<string, readonly (readonly [number, number])[]>();
  for (const name of physical) {
    if (atName.get(name)?.isLand) continue;
    const ids = lookup.partnerIds(normalizeName(name));
    if (ids && ids.length > 0) pi.set(name, ids);
  }
  const deck: DeckSide = { names: new Set(physical), identity: new Set(input.commanderColorIdentity), pi };
  const admissible = (c: IndexCard): boolean =>
    !c.isLand && !deck.names.has(c.name) && c.identity.every((x) => deck.identity.has(x));
  const pool = candidatePool(deck, index);

  // THE RANKED LISTS, BEFORE VERIFICATION. Twice the room is taken so a stale pair does not leave a
  // list short when a later candidate would have filled it.
  const groups = groupsOf(report);
  const interactionBand = BUILD_PARENTS.find((p) => p.key === "interaction")?.costBand ?? ANY_BAND;
  const planRanked = planList(pool, PLAN_LIMIT * 2);
  const buildRanked = groups
    .filter((g) => g.target > 0 && g.count < g.target)
    .map((g) => [g.name, gapList(pool, g.leaves, g.costBand, (g.target - g.count + SPARES) * 2), g.target - g.count + SPARES] as const);
  const answersRanked = (report.deckMath?.answers ?? [])
    .filter((a) => a.class !== "graveyard" && a.count < a.required)
    .map((a) => [a.class, answerList(pool, a.class, interactionBand, (a.required - a.count + SPARES) * 2), a.required - a.count + SPARES] as const);
  const unmet = (report.deckMath?.demand ?? [])
    .filter((d) => d.available !== null && d.suppliers === 0 && d.consumers > 0);
  const eventKeys = unmet.length > 0 ? Object.keys((await lookup.eventFrequency()).supply ?? {}) : [];
  const synergyRanked: (readonly [string, Candidate[]])[] = [];
  for (const d of unmet) {
    const positions = new Set<number>();
    for (const k of eventKeysForDemand(d.key, eventKeys)) {
      for (const p of (await lookup.eventMembers(k))?.p ?? []) positions.add(p);
    }
    const ranked = [...positions]
      .map((p) => index[p])
      .filter((c): c is IndexCard => c !== undefined && admissible(c))
      .map((c) => pool.get(c.pos) ?? { card: c, connections: [], score: 0 })
      .sort(byConnection)
      .slice(0, SYNERGY_LIMIT);
    synergyRanked.push([d.key, ranked]);
  }
  const cuts: CutSide[] = (report.cutList ?? []).map((row) => ({
    name: row.name,
    roles: report.cards.find((c) => (c.cardName ?? c.name) === row.name)?.roles ?? [],
    connections: row.partners,
  }));
  const pairsRanked = pairReplacements(cuts, groups, pool, planRanked);

  // ONE PREFETCH FOR EVERY CANDIDATE THAT MIGHT BE SHOWN, so verification reads a warm lookup.
  const shown = unique([
    ...planRanked, ...buildRanked.flatMap(([, l]) => l), ...answersRanked.flatMap(([, l]) => l),
    ...synergyRanked.flatMap(([, l]) => l), ...pairsRanked.map((p) => p.add),
  ].map((c) => c.card.name));
  await lookup.prefetch(shown.map(normalizeName));
  const verify = verifier(deckCards(lookup));
  const nonland = physical.filter((n) => !atName.get(n)?.isLand);

  const out: DeckSuggestions = { build: {}, answers: {}, synergy: {}, plan: [], pairs: [] };
  for (const [name, list, limit] of buildRanked) out.build[name] = await verified(list, limit, verify);
  for (const [cls, list, limit] of answersRanked) out.answers[cls] = await verified(list, limit, verify);
  for (const [key, list] of synergyRanked) {
    const cards: SuggestedCard[] = [];
    for (const c of list) {
      const s = await verify(c.card, nonland, true);
      if (s) cards.push(s);
    }
    out.synergy[key] = cards;
  }
  for (const p of pairsRanked) {
    const add = await verify(p.add.card, p.add.connections.map((x) => x.deckCard), false);
    if (!add) { console.warn("[suggest] stale pair: the engine draws nothing for", p.add.card.name); continue; }
    const cutConnections = cuts.find((c) => c.name === p.cut)?.connections ?? 0;
    out.pairs.push({ cut: p.cut, add, rule: p.rule, counts: p.counts, cutConnections });
  }

  // ONE CARD, ONE PLACE: a card a finding already names leaves the plan list and says so there.
  const plan = await verified(planRanked, PLAN_LIMIT * 2, verify);
  const onFindings = [...Object.values(out.build), ...Object.values(out.answers), ...Object.values(out.synergy)].flat();
  const planNames = new Set(plan.map((c) => c.name));
  for (const c of onFindings) if (planNames.has(c.name)) c.alsoPlan = true;
  const taken = new Set(onFindings.map((c) => c.name));
  out.plan = plan.filter((c) => !taken.has(c.name)).slice(0, PLAN_LIMIT);
  return out;
}
