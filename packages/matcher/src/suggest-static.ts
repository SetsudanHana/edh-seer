/** DECK SUGGESTIONS IN THE BROWSER (spec docs/superpowers/specs/2026-09-24-deck-suggestions-design.md,
 *  roadmap AO3): every finding a card can fix names the cards that fix it.
 *
 *  Lazily imported by the client after the report renders, like `api.static.ts`, and fed from the
 *  same static artifacts. The candidate pool is each deck card's `pi` (partner positions riding in
 *  the `cards/` shards the report already prefetched), ranked by `suggest.ts`.
 *
 *  THE ENGINE HAS THE LAST WORD. Every row shown carries reasons from `directedReasons`, asked the
 *  way a card page asks it (a pair, no token nodes) with the report's face split and land types. A pool candidate the live engine draws nothing for is DROPPED --
 *  only a stale artifact produces one, and a card with no reason under it is a claim with nothing
 *  behind it. Unmet-demand candidates, which come from an over-collecting key filter, are shown only
 *  when the engine finds a reason from them to a deck card. */
import type { DeckReport } from "@edh-seer/engine";
import { docToCard } from "@edh-seer/data/docs";
import { normalizeName } from "@edh-seer/data/names";
import { StaticLookup } from "./static-lookup.js";
import { directedReasons, sizeMeets, type ReasonOptions } from "./edges.js";
import { faceDeckCards } from "./faces.js";
import { deckLandTypes } from "./chosen-type.js";
import { maxAxisWeight } from "./axis.js";
import { loadHierarchy } from "./hierarchy.js";
import { BUILD_CATEGORIES, BUILD_PARENTS } from "./build.js";
import { POOL_CLASSES } from "./answer-pool.js";
import {
  answerList, bestRoute, byConnection, byHint, byPlan, candidatePool, gapList, pairReplacements, planList,
  type Candidate, type CutSide, type DeckSide, type GroupState, type IndexCard,
} from "./suggest.js";
import { demandForms, demandKeysOf, eventKey, splitKey, supplyForms, supplyKeysOf } from "./partners-core.js";
import type { CardTags, GameEvent } from "@edh-seer/tagger";
import { axisEventKeys, eventKeysForDemand } from "./suggest-keys.js";
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
  /** THE ROUTE IT OPENS (`routes` list): deck cards that reach `to` only through this card. */
  route?: { to: string; from: string[] };
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
  /** "N cards reach T through X" (owner, 2026-08-27, the Ghyrson case): candidates that open a
   *  two-hop route the deck does not have, most new sources first. */
  routes: SuggestedCard[];
}

const PLAN_LIMIT = 8;
/** Per slot shown, how many candidates the engine is asked about, in `byHint` order. Each costs a
 *  card-shard fetch in the browser (~11 KB) plus a pass over the deck, so this is the dial between
 *  speed and accuracy (A-vs-B 2026-09-24).
 *  CEILING: an on-plan card the hint misses and connection count ranks low is never asked about. */
const SHORTLIST = 6;
/** Routes listed, the client's `ROUTE_MIDDLE_CAP`: a list long enough to scroll is not read. */
const ROUTE_LIMIT = 4;
/** A route's far side: events at least this many deck cards supply, the deck's `ROUTE_KEYS` most
 *  supplied; its near side, the `ROUTE_KEYS` events most deck cards ask for. */
const ROUTE_MIN_SOURCES = 3;
const ROUTE_KEYS = 8;
/** Axis tags at or above this weight are looked up for the hint (`analyze.ts` AXIS_ON_THRESHOLD). */
const HINT_MIN = 0.25;
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

/** A verified card and how far its edges sit on the deck's strategy axis: the sum, over the deck
 *  cards it connects to, of the strongest axis weight among that pair's reason tags. An off-plan
 *  edge adds ~0, so a card joined to seventy deck cards through generic tags does not outrank one
 *  joined to twenty through the deck's plan (measured 2026-09-24: Prism Ring led 47 of 71 decks). */
interface Verified {
  card: SuggestedCard; onPlan: number; score: number;
  /** Deck cards on each side of the engine's reasons: this card feeds them / they feed this card. */
  feeds: string[]; fedBy: string[];
  /** Per deck card this one feeds, the axis weight of that hop's reasons. */
  feedWeight: Map<string, number>;
}
type Verify = (candidate: IndexCard, against: readonly string[], producerOnly: boolean) => Promise<Verified | null>;

/** Run the engine on (deck card, candidate) in both directions -- or candidate -> deck card only,
 *  for an unmet demand the candidate must SUPPLY -- and keep the deck cards it draws a reason with. */
function verifier(dc: (name: string) => Promise<DeckCard | null>, landTypes: ReasonOptions["landTypes"], axis: Map<string, number>): Verify {
  const h = loadHierarchy();
  // NO TOKEN NODE EXISTS HERE, exactly as on a card page: the report drops a maker's direct "a token
  // enters" edge for the two-hop path through the token node, and a suggestion has no node to carry
  // that hop -- so ask the way `partners-core` asks, or every token maker's partner reads as stale.
  // THE DECK'S LAND TYPES, as the report threads them (`analyze.ts` reasonOpts), so an untyped land
  // put resolves against this deck's lands here too.
  const opts: ReasonOptions = { tokensMediate: false, ...(landTypes ? { landTypes } : {}) };
  // ONE ENGINE RUN PER QUESTION: a card on two shortlists is asked once.
  const memo = new Map<string, Promise<Verified | null>>();
  return (candidate, against, producerOnly) => {
    const key = `${candidate.name}\u0000${producerOnly}\u0000${against.join("\u0000")}`;
    let p = memo.get(key);
    if (!p) memo.set(key, p = run(candidate, against, producerOnly));
    return p;
  };
  async function run(candidate: IndexCard, against: readonly string[], producerOnly: boolean): Promise<Verified | null> {
    // ONE CARD'S UNREADABLE DATA DROPS THAT CARD, not every list: a throw here would reject the
    // whole result and the reader would see nothing at all.
    try {
      const y = await dc(candidate.name);
      if (!y) return null;
      // FACE BY FACE, as the report matches (`faceDeckCards`): the reason names the face that does
      // the work, and one face's abilities are never read as live on the other.
      const yFaces = faceDeckCards(y);
      const connections: string[] = [];
      const reasons: string[] = [];
      const feeds: string[] = [];
      const fedBy: string[] = [];
      const feedWeight = new Map<string, number>();
      let onPlan = 0;
      for (const name of against) {
        const x = await dc(name);
        if (!x) continue;
        const out = [];
        const into = [];
        for (const xf of faceDeckCards(x)) {
          for (const yf of yFaces) {
            out.push(...directedReasons(yf, xf, h, opts));
            if (!producerOnly) into.push(...directedReasons(xf, yf, h, opts));
          }
        }
        const found = [...out, ...into];
        if (found.length === 0) continue;
        if (out.length > 0) { feeds.push(name); feedWeight.set(name, maxAxisWeight(out, axis)); }
        if (into.length > 0) fedBy.push(name);
        connections.push(name);
        onPlan += maxAxisWeight(found, axis);
        for (const r of found) if (!reasons.includes(r.text)) reasons.push(r.text);
      }
      if (connections.length === 0) return null;
      return { card: { name: candidate.name, slug: candidate.slug, identity: candidate.identity, mv: candidate.mv, connections, reasons }, onPlan, score: 0, feeds, fedBy, feedWeight };
    } catch (err) {
      console.warn("[suggest] the engine could not read", candidate.name, err);
      return null;
    }
  }
}

/** Verify a shortlist against EVERY nonland deck card, re-rank what the engine agrees with on the
 *  deck's axis (a finding's cost band first, when it has one), and keep `limit`. The whole deck and
 *  not only the candidate's `pi` connections: `pi` is a pool, and a card joined to forty deck cards
 *  through the plan was scored on the few whose lists it made (A-vs-B 2026-09-24: A's #1 had 17
 *  connections, the full search's 70). About 0.04 ms a pair in node. A pool candidate the engine
 *  does not agree with is a stale pair, and is said so in the console rather than shown. */
async function verified(
  list: readonly Candidate[], limit: number, verify: Verify, deck: readonly string[],
  band: readonly [number, number] = ANY_BAND, minConnections = 1,
): Promise<SuggestedCard[]> {
  const out: Verified[] = [];
  for (const c of list) {
    const s = await verify(c.card, deck, false);
    if (s && s.card.connections.length >= minConnections) out.push({ ...s, card: { ...s.card }, score: c.score });
    // ONLY A `pi` CANDIDATE CAN BE STALE: a hinted one was never claimed, so the engine refusing it
    // is the filter working.
    else if (!s && c.connections.length > 0) console.warn("[suggest] stale pair: the engine draws nothing for", c.card.name);
  }
  const bandOf = (v: Verified): number => Number(v.card.mv >= band[0] && v.card.mv <= band[1]);
  return out.sort((a, b) => bandOf(b) - bandOf(a) || byPlan(a, b)).slice(0, limit).map((v) => v.card);
}

/** The shortlist a list takes to the engine: band first, then `byHint`, `n` long. */
function shortlist(list: readonly Candidate[], n: number, band: readonly [number, number] = ANY_BAND): Candidate[] {
  const inBand = (c: Candidate): number => Number(c.card.mv >= band[0] && c.card.mv <= band[1]);
  return [...list].sort((a, b) => inBand(b) - inBand(a) || byHint(a, b)).slice(0, n);
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

  const pi = new Map<string, readonly (readonly [number, number, ...number[]])[]>();
  for (const name of physical) {
    if (atName.get(name)?.isLand) continue;
    const ids = lookup.partnerIds(normalizeName(name));
    if (ids && ids.length > 0) pi.set(name, ids);
  }
  const deck: DeckSide = { names: new Set(physical), identity: new Set(input.commanderColorIdentity), pi };
  const admissible = (c: IndexCard): boolean =>
    !c.isLand && !deck.names.has(c.name) && c.identity.every((x) => deck.identity.has(x));
  const pool = candidatePool(deck, index);
  const axis = new Map((report.axis ?? []).map((a) => [a.tag, a.weight] as const));

  // THE AXIS HINT FOR A `pi` CANDIDATE IS EXACT PER PAIR: each entry carries the reason tags the
  // engine wrote for it, so its on-plan weight is the same sum `verified` measures, over the deck
  // cards whose lists hold it -- no card fetched, no engine run.
  const { pairTags } = await lookup.nameIndexVocabulary();
  const tagWeight = pairTags.map((t) => axis.get(t) ?? 0);
  for (const c of pool.values()) {
    c.hint = c.connections.reduce((sum, x) => sum + Math.max(0, ...(x.tags ?? []).map((t) => tagWeight[t] ?? 0)), 0);
  }
  const dc = deckCards(lookup);
  const deckDcs = (await Promise.all(physical.map(dc))).filter((x): x is DeckCard => x !== null);

  // THE AXIS HINT, from the `events/` membership index -- no candidate card fetched. For each strategy
  // event a candidate that causes it is credited with the deck cards that ask for it, and the
  // reverse, at the event's axis weight: an estimate of the on-plan sum `verified` will measure. Per
  // tag, its best key; summed over tags. THE DECK SIDE IS COUNTED FROM THE DECK'S OWN FORMS
  // (`supplyKeysOf`/`demandKeysOf`, as `partners-core` indexes them), not from the membership lists:
  // those list only cards that explicitly cause an event, so a deck of forty enchantments read as
  // almost no one causing "an enchantment enters".
  //
  // IT ALSO WIDENS THE POOL. A card asking for a COMMON event is crowded out of every deck card's
  // `pi` (the build verifies 200 candidates a card, rarest events first): Doomwake Giant sits in one
  // Braids card's list while the engine joins it to 41 (A-vs-B 2026-09-24). Admissible members of
  // the deck's strategy events join the pool with no `pi` connection and let the engine decide.
  const eventKeys = Object.keys((await lookup.eventFrequency()).supply ?? {});
  const deckForms = (formsOf: (d: DeckCard) => string[]): Map<string, number> => {
    const n = new Map<string, number>();
    for (const d of deckDcs) for (const k of new Set(formsOf(d))) n.set(k, (n.get(k) ?? 0) + 1);
    return n;
  };
  const deckSupply = deckForms((d) => supplyKeysOf(d).flatMap(supplyForms));
  // WHAT A CARD DOES BY BEING WHAT IT IS, which no emit carries: a permanent entering by being cast,
  // a spell being cast, a permanent a static reaches. The engine matches these on the type line, so
  // the forms miss them (Braids: 40 enchantments, 0 supply forms for `enters|enchantment`; Amarant's
  // instants for `cast|instant`; Abzan's creatures under `applies:pump`, measured 2026-09-24).
  const PERMANENT = new Set(["artifact", "battle", "creature", "enchantment", "land", "planeswalker"]);
  const byType = (key: string): number => {
    const [verb, type, subtype, token] = key.split("|");
    const reached = verb!.startsWith("applies:");
    if (token === "t" || (verb !== "enters" && verb !== "cast" && !reached)) return 0;
    return deckDcs.filter((d) => {
      const c = d.tags?.characteristics;
      const types = (c?.types ?? []).map((x) => x.toLowerCase());
      const subtypes = (c?.subtypes ?? []).map((x) => x.toLowerCase());
      const permanent = types.some((t) => PERMANENT.has(t));
      if (verb === "cast" ? types.includes("land") : !permanent) return false;
      return (type === "-" || type === "spell" || (type === "permanent" && permanent) || types.includes(type!))
        && (subtype === "-" || subtypes.includes(subtype!));
    }).length;
  };
  const deckDemand = deckForms((d) => demandKeysOf(d).flatMap(demandForms));
  const estimate = new Map<number, number>();
  await Promise.all([...axis].filter(([, w]) => w >= HINT_MIN).map(async ([tag, w]) => {
    const keys = axisEventKeys(tag, eventKeys);
    const members = await Promise.all(keys.map((k) => lookup.eventMembers(k)));
    const best = new Map<number, number>();
    for (const [i, m] of members.entries()) {
      if (!m) continue;
      const reached = keys[i]!.startsWith("applies:");
      const askers = Math.max(deckDemand.get(keys[i]!) ?? 0, reached ? byType(keys[i]!) : 0);
      const causers = Math.max(deckSupply.get(keys[i]!) ?? 0, reached ? 0 : byType(keys[i]!));
      for (const [side, n] of [[m.p, askers], [m.c, causers]] as const) {
        if (n === 0) continue;
        for (const p of side) if ((best.get(p) ?? 0) < n) best.set(p, n);
      }
    }
    for (const [p, n] of best) estimate.set(p, (estimate.get(p) ?? 0) + w * n);
  }));
  // THE LARGER OF THE TWO: `pi`'s is exact per pair but counts only the lists that hold the card;
  // the estimate counts the whole deck but reads the event index, not the engine.
  for (const [p, e] of estimate) {
    let c = pool.get(p);
    if (!c) {
      const card = index[p];
      if (!card || !admissible(card)) continue;
      c = { card, connections: [], score: 0 };
      pool.set(p, c);
    }
    c.hint = Math.max(c.hint ?? 0, e);
  }

  // THE RANKED LISTS, BEFORE VERIFICATION. Twice the room is taken so a stale pair does not leave a
  // list short when a later candidate would have filled it.
  const groups = groupsOf(report);
  const interactionBand = BUILD_PARENTS.find((p) => p.key === "interaction")?.costBand ?? ANY_BAND;
  // A HINTED CARD HAS NO `pi` CONNECTION to count yet; the two-connection rule is applied to what
  // the engine finds (`verified`, `minConnections`).
  const planRanked = shortlist([...pool.values()].filter((c) => c.connections.length >= 2 || (c.hint ?? 0) > 0), PLAN_LIMIT * SHORTLIST);

  const buildRanked = groups
    .filter((g) => g.target > 0 && g.count < g.target)
    .map((g) => [g.name, shortlist(gapList(pool, g.leaves, g.costBand, Infinity), (g.target - g.count + SPARES) * SHORTLIST, g.costBand), g.target - g.count + SPARES, g.costBand] as const);
  const answersRanked = (report.deckMath?.answers ?? [])
    .filter((a) => a.class !== "graveyard" && a.count < a.required)
    .map((a) => [a.class, shortlist(answerList(pool, a.class, interactionBand, Infinity), (a.required - a.count + SPARES) * SHORTLIST, interactionBand), a.required - a.count + SPARES, interactionBand] as const);
  const unmet = (report.deckMath?.demand ?? [])
    .filter((d) => d.available !== null && d.suppliers === 0 && d.consumers > 0);
  const synergyRanked: (readonly [string, Candidate[]])[] = [];
  for (const d of unmet) {
    const positions = new Set<number>();
    const members = await Promise.all(eventKeysForDemand(d.key, eventKeys).map((k) => lookup.eventMembers(k)));
    for (const m of members) for (const p of m?.p ?? []) positions.add(p);
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
  const verify = verifier(dc, deckLandTypes(deckDcs), axis);
  const nonland = physical.filter((n) => !atName.get(n)?.isLand);

  const out: DeckSuggestions = { build: {}, answers: {}, synergy: {}, plan: [], pairs: [], routes: [] };
  for (const [name, list, limit, band] of buildRanked) out.build[name] = await verified(list, limit, verify, nonland, band);
  for (const [cls, list, limit, band] of answersRanked) out.answers[cls] = await verified(list, limit, verify, nonland, band);
  for (const [key, list] of synergyRanked) {
    const cards: SuggestedCard[] = [];
    for (const c of list) {
      const s = await verify(c.card, nonland, true);
      if (s) cards.push({ ...s.card });
      // EACH CANDIDATE HERE RUNS THE ENGINE AGAINST THE WHOLE DECK, synchronously once the lookup is
      // warm; hand the thread back between them so a deck with many unmet demands cannot jank the
      // page the report has already painted.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    out.synergy[key] = cards;
  }
  for (const p of pairsRanked) {
    const add = await verify(p.add.card, p.add.connections.map((x) => x.deckCard), false);
    if (!add) { console.warn("[suggest] stale pair: the engine draws nothing for", p.add.card.name); continue; }
    const cutConnections = cuts.find((c) => c.name === p.cut)?.connections ?? 0;
    out.pairs.push({ cut: p.cut, add: { ...add.card }, rule: p.rule, counts: p.counts, cutConnections });
  }

  // ONE CARD, ONE PLACE: a card a finding already names leaves the plan list and says so there.
  const plan = await verified(planRanked, PLAN_LIMIT * 2, verify, nonland, ANY_BAND, 2);
  const onFindings = [...Object.values(out.build), ...Object.values(out.answers), ...Object.values(out.synergy)].flat();
  const planNames = new Set(plan.map((c) => c.name));
  for (const c of onFindings) if (planNames.has(c.name)) c.alsoPlan = true;
  const taken = new Set(onFindings.map((c) => c.name));
  out.plan = plan.filter((c) => !taken.has(c.name)).slice(0, PLAN_LIMIT);

  // ROUTES: a bridge is rarely on the axis itself (Impact Tremors joins thirty token makers to
  // Ghyrson through "a creature enters", weight ~0) and rarely in `pi` -- its event is asked by two
  // thousand cards, so every list keeps the same sixteen (Tremors: 1 `pi` connection, 31 real, the
  // witness deck 2026-09-25). So its shortlist comes from the event index: a card that ASKS for one
  // of the deck's most-supplied events and CAUSES one the deck asks for, ordered by how many deck
  // cards supply what it asks. The engine then names the route.
  const adj = new Set((report.edges ?? []).flatMap((e) => [`${e.a}\u0000${e.b}`, `${e.b}\u0000${e.a}`]));
  const adjacent = (a: string, b: string): boolean => adj.has(`${a}\u0000${b}`);
  const commanders = new Set(report.cards.filter((c) => c.isCommander).map((c) => c.cardName ?? c.name));
  // AMONG EQUAL COUNTS THE NAMED KEY FIRST: every token maker supplies `enters|-|-|-`,
  // `enters|permanent|-|-` and `enters|creature|-|-` alike, and only the last is what Impact Tremors
  // asks for -- by name order the generic forms took every slot (witness deck, 2026-09-25).
  const named = (k: string): number => k.split("|").slice(1, 3).filter((x) => x !== "-" && x !== "permanent" && x !== "spell").length;
  const supplied = eventKeys
    .map((k) => [k, Math.max(deckSupply.get(k) ?? 0, byType(k))] as const)
    .filter(([, n]) => n >= ROUTE_MIN_SOURCES)
    .sort((a, b) => b[1] - a[1] || named(b[0]) - named(a[0]) || a[0].localeCompare(b[0]))
    .slice(0, ROUTE_KEYS * 2);
  // THE COMMANDER'S OWN DEMANDS ALWAYS: one asker is the deck's whole plan when it is the commander.
  const commanderAsks = new Set(deckDcs.filter((d) => commanders.has(d.card.name)).flatMap((d) => demandKeysOf(d).flatMap(demandForms)));
  const asked = [
    ...eventKeys.filter((k) => commanderAsks.has(k)).map((k) => [k, deckDemand.get(k) ?? 1] as const),
    ...eventKeys
      .filter((k) => !commanderAsks.has(k))
      .map((k) => [k, deckDemand.get(k) ?? 0] as const)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, ROUTE_KEYS),
  ];
  const [supMembers, askMembers] = await Promise.all([supplied, asked].map((ks) => Promise.all(ks.map(([k]) => lookup.eventMembers(k)))));
  // THE NEAR HOP IS PRICED ON THE AXIS BEFORE THE ENGINE RUNS, or thirty-three generic "a permanent
  // enters" askers fill the shortlist ahead of the one that feeds the commander (witness deck).
  const keyWeight = new Map<string, number>();
  for (const [tag, w] of axis) for (const k of axisEventKeys(tag, eventKeys)) keyWeight.set(k, Math.max(keyWeight.get(k) ?? 0, w));
  // A SIZED DEMAND DROPS A CAUSER OF THE WRONG SIZE HERE, before any card is fetched: Ghyrson wants
  // exactly 1 damage, and the "whenever a spell is cast" pingers that deal 2 had taken 161 shortlist
  // places ahead of Impact Tremors (witness deck, 2026-09-25). Only when EVERY deck card asking for
  // the key states a size; `pd` is the causers' own (`EventMembers.pd`).
  const sized = new Map<string, NonNullable<NonNullable<CardTags["abilities"][number]["trigger"]>["amount"]>[]>();
  const unsized = new Set<string>();
  for (const d of deckDcs) {
    for (const a of d.tags?.abilities ?? []) {
      if (!a.trigger || a.trigger.subject.self === true) continue;
      const keys = a.trigger.verbs.flatMap((v) => splitKey(eventKey({ verb: v, subject: a.trigger!.subject } as GameEvent))).flatMap(demandForms);
      for (const k of keys) {
        if (a.trigger.amount) sized.set(k, [...(sized.get(k) ?? []), a.trigger.amount]);
        else unsized.add(k);
      }
    }
  }
  const nearWeight = new Map<number, number>();
  askMembers.forEach((m, i) => {
    const key = asked[i]![0];
    const w = keyWeight.get(key) ?? 0;
    const wants = unsized.has(key) ? undefined : sized.get(key);
    (m?.p ?? []).forEach((p, j) => {
      const sizes = m?.pd?.[j];
      if (wants && sizes && !wants.some((r) => sizes.some((n) => sizeMeets(n, r)))) return;
      if ((nearWeight.get(p) ?? 0) < w) nearWeight.set(p, w);
    });
  });
  const sources = new Map<number, { n: number; key: string }>();
  supMembers.forEach((m, i) => {
    for (const p of m?.c ?? []) {
      const w = nearWeight.get(p);
      const n = supplied[i]![1] * (w ?? 0);
      if (w && n > (sources.get(p)?.n ?? 0)) sources.set(p, { n, key: supplied[i]![0] });
    }
  });
  // ROUND-ROBIN ACROSS THE FAR EVENTS, each best estimate first: the deck casts 31 spells and makes 30
  // creatures enter, and by estimate alone every "whenever you cast a spell" payoff outranked Impact
  // Tremors -- 161 of them (witness deck, 2026-09-25). The crowding `partners-core`'s pool pass fixes
  // at build time, fixed again here one step later. Twice the plan's room: the estimate cannot see
  // the engine's subject gates, so near-ties are many.
  const byKey = new Map<string, (readonly [IndexCard, number])[]>();
  for (const [p, { n, key }] of sources) {
    const card = index[p];
    if (!card || !admissible(card)) continue;
    const l = byKey.get(key);
    if (l) l.push([card, n]); else byKey.set(key, [[card, n]]);
  }
  const queues = [...byKey.values()]
    .map((l) => l.sort((a, b) => b[1] - a[1] || a[0].mv - b[0].mv || a[0].name.localeCompare(b[0].name, "en")))
    .sort((a, b) => b[0]![1] - a[0]![1]);
  const routeCap = ROUTE_LIMIT * SHORTLIST * 2;
  const routeRanked: IndexCard[] = [];
  for (let i = 0; routeRanked.length < routeCap && queues.some((q) => q[i]); i++) {
    for (const q of queues) if (q[i] && routeRanked.length < routeCap) routeRanked.push(q[i]![0]);
  }

  await lookup.prefetch(routeRanked.map((c) => normalizeName(c.name)));
  const routes: { card: SuggestedCard; n: number }[] = [];
  for (const c of routeRanked) {
    const v = await verify(c, nonland, false);
    const r = v && bestRoute(v.feeds, v.fedBy, adjacent, (to) => v.feedWeight.get(to) ?? 0);
    if (v && r) routes.push({ card: { ...v.card, route: { to: r.to, from: r.from } }, n: r.worth });
  }


  out.routes = routes.sort((a, b) => b.n - a.n || a.card.mv - b.card.mv || a.card.name.localeCompare(b.card.name, "en"))
    .slice(0, ROUTE_LIMIT).map((r) => r.card);
  return out;
}
