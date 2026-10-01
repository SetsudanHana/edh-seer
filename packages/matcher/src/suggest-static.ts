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
import { loadImpactWeights, type DeckReport, type ImpactWeights, type Reason } from "@edh-seer/engine";
import { cardStrength, type CardLink, type Strength } from "./card-strength.js";
import { extendRoutes, findRoutes, indexRoutes, type RouteHop } from "./routes.js";
import { docToCard } from "@edh-seer/data/docs";
import { normalizeName } from "@edh-seer/data/names";
import { StaticLookup } from "./static-lookup.js";
import { directedReasons, sizeMeets, type ReasonOptions } from "./edges.js";
import { faceDeckCards } from "./faces.js";
import { deckLandTypes, deckSubtypeCounts, resolveChosenTypes } from "./chosen-type.js";
import { commanderSubtypes, markCommander, resolveSharedTypes } from "./commander.js";
import { maxAxisWeight } from "./axis.js";
import { loadHierarchy } from "./hierarchy.js";
import { BUILD_CATEGORIES, BUILD_PARENTS } from "./build.js";
import { POOL_CLASSES } from "./answer-pool.js";
import {
  answerList, byConnection, byHint, byPlan, candidatePool, gapList, pairReplacements, stapleList,
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
  /** The engine's own sentences, in connection order, ONE PER SHAPE: a sentence that differs from
   *  another only in which deck card it names is the same reason, so it is kept once and the other
   *  deck cards are listed in `others` (owner 2026-09-25 -- Carnival of Souls read "and 101 more",
   *  the same line once per Wizard). */
  reasons: SuggestedReason[];
  /** Also qualifies for "Strengthen what works", shown here instead (one card, one place). */
  alsoPlan?: true;
  /** THE ROUTE IT OPENS (`routes` list): deck cards that reach `to` only through this card, and the
   *  SHORTEST chain among them, one engine sentence per hop (ability routes, 2026-09-25). */
  route?: { to: string; from: string[]; chain: RouteHop[] };
  /** The card's own rules text, so a reader can check the claim against the card (persona round
   *  2026-09-25: "I'd need each card's text next to the reason it gives"). */
  oracle?: string;
  /** On a `build` list: the group it counts toward ("Ramp"), by the report's own rules. */
  fills?: string;
  /** On an `answers` list: the permanent classes it answers ("enchantment"). A list, so a client
   *  merging two class lists can name both. */
  answers?: string[];
  /** The card's art crop, or its front face's for a two-faced card, so a client can show the card
   *  itself rather than a line of text (appeal review 2026-09-26: "Cards that fit" ran 22 screens of
   *  text). */
  art?: string;
}
export interface SuggestedReason {
  /** The sentence, naming the first deck card it was found with. */
  text: string;
  /** The other deck cards the same sentence holds for, in connection order. */
  others: string[];
}
export interface SuggestedPair {
  cut: string;
  add: SuggestedCard;
  rule: "cross-job" | "same-job" | "no-role";
  counts: { group: string; from: number; to: number }[];
  /** The deck cards the cut has a reason with, read as the add is (`cutStrength.partners`). */
  cutConnections: number;
  /** Both cards weighed by the report's per-card formula, against the deck without the cut: the
   *  add's is always the greater, which is the one claim a pair makes. */
  cutStrength: Strength;
  addStrength: Strength;
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
/** A card the engine could not read does nothing measurable for the deck. */
const NO_STRENGTH: Strength = { strength: 0, partners: 0, onTheme: 0, commander: false };
/** A deck card in the shape `verify` asks about: only its name is read. */
const deckIndexCard = (name: string): IndexCard => ({ pos: -1, name, slug: "", identity: [], isLand: false, mv: 0, roles: [], answers: [] });
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
/** Answers offered for a kind of permanent the deck cannot answer at all, before the spares. */
const ANSWER_ADDS = 1;
/** Unmet-demand candidates taken to verification per key. */
const SYNERGY_LIMIT = 10;
/** A band no card falls outside, for a group `BUILD_PARENTS` does not know. */
const ANY_BAND: readonly [number, number] = [0, Infinity];

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** A DRAWBACK IS NOT A SYNERGY (#567, #647): an ability the player does not choose to use that kills
 *  their own creatures -- a whole-board wipe, or a trigger that fires on every spell or every creature
 *  entering. Its `dies` reaches the deck's death payoffs and every edge is rules-true, but on the
 *  "Strengthen what works" lists it read as a plan (Desecration Elemental "opens a route" to Butcher
 *  of Malakir; Lethal Vapors "puts cards into the graveyard" in a 45-creature deck). An activated
 *  cost is the player's choice, and a once-only symmetric edict (Fleshbag Marauder) picks the worst
 *  creature, so neither counts. A whole-board SACRIFICE is one too ("you may sacrifice any number",
 *  Sephiroth; "half ... of their choice", Zodiark): only a destroy or a -N/-N wipe kills what the
 *  player would keep. A token dying is fodder (a decayed Zombie, Curse of the Restless Dead), and a
 *  printed "you may sacrifice" is a choice the tags cannot carry (The Sackville-Bagginses derives
 *  its own ETB as a repeatable trigger), read off the text as `fodderEdges` reads its edict cue.
 *  The build and answer lists keep wipes: there a wipe is what is asked. */
const YOU_MAY_SACRIFICE = /\byou may sacrifice\b/i;
/** A HELD EXILE (#650): the card comes back only when THIS permanent leaves (Portcullis), so until then
 *  the creature is as gone as a destroyed one. A flicker returns it at once (Brago, Conjurer's Closet). */
// CEILING: read from the whole card's text, so a card with a held return on one ability and an
// unrelated repeatable exile on another would count the second; none known in the corpus.
const HELD_EXILE = /\bwhen (?:this|that) [a-z]+ leaves the battlefield\b/i;
const YOU_MAY_EXILE = /\byou may exile\b/i;
export function killsOwnCreatures(tags: CardTags | null | undefined, oracle = ""): boolean {
  const optional = YOU_MAY_SACRIFICE.test(oracle);
  // A CHOSEN held exile is the player's call, as "you may sacrifice" is (review).
  const held = HELD_EXILE.test(oracle) && !YOU_MAY_EXILE.test(oracle);
  return (tags?.abilities ?? []).some((a) => {
    if (a.kind === "activated") return false;
    if (held && a.repeats === "repeatable" && (a.emits ?? []).some((e) => e.verb === "exiled"
      && [e.subject.type].flat().includes("creature") && e.subject.control !== "opp" && e.subject.self !== true && e.subject.token !== true)) return true;
    const sacrifices = (a.emits ?? []).some((e) => e.verb === "sacrifice");
    if (sacrifices && optional) return false;
    return (a.emits ?? []).some((e) =>
      (e.verb === "dies" || e.verb === "sacrifice") && [e.subject.type].flat().includes("creature")
      && e.subject.control !== "opp" && e.subject.self !== true && e.subject.token !== true
      && (a.repeats === "repeatable" || (e.subject.scope === "all" && !sacrifices)));
  });
}

/** The name index, decoded into what `suggest.ts` ranks on. */
export async function decodeIndex(lookup: StaticLookup): Promise<IndexCard[]> {
  const [rows, vocab] = await Promise.all([lookup.nameIndex(), lookup.nameIndexVocabulary()]);
  const land = vocab.types.indexOf("land");
  return rows.map((row, pos) => ({
    pos, name: row.name, slug: row.slug, identity: row.identity, mv: row.mv ?? 0,
    isLand: land >= 0 && (row.t ?? []).includes(land),
    roles: (row.r ?? []).map((i) => BUILD_CATEGORIES[i]!).filter(Boolean),
    ...(row.q ? { quality: Object.fromEntries((row.r ?? []).map((i, j) => [BUILD_CATEGORIES[i]!, row.q![j]!] as const).filter(([role, v]) => role && v >= 0)) } : {}),
    answers: (row.a ?? []).map((i) => POOL_CLASSES[i]!).filter(Boolean),
    ...(row.g ? { grade: row.g } : {}),
  }));
}

/** The engine's view of a card, built the way `build-static.ts` builds the partner corpus. */
export function deckCards(lookup: StaticLookup): (name: string) => Promise<DeckCard | null> {
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
  /** The engine's raw reasons between this card and the deck, both directions, carrying the ability
   *  indices `findRoutes` needs (ability routes, spec 2026-09-25). */
  hops: Reason[];
  /** What the card does for this deck, by the report's per-card formula (`card-strength.ts`). Only
   *  meaningful when both directions were asked (`producerOnly` false). */
  strength: Strength;
}
type Verify = (candidate: IndexCard, against: readonly string[], producerOnly: boolean) => Promise<Verified | null>;

/** Run the engine on (deck card, candidate) in both directions -- or candidate -> deck card only,
 *  for an unmet demand the candidate must SUPPLY -- and keep the deck cards it draws a reason with. */
function verifier(
  dc: (name: string) => Promise<DeckCard | null>, landTypes: ReasonOptions["landTypes"], axis: Map<string, number>,
  commanders: ReadonlySet<string>, weights: ImpactWeights,
): Verify {
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
      const reasons: SuggestedReason[] = [];
      // SHAPE KEY: the tag plus the sentence with the deck card's own name masked out, so "When a
      // Wizard enters thanks to Inalla, ..." and the same line for Harmonic Prodigy are one reason.
      const byShape = new Map<string, { reason: SuggestedReason; first: string }>();
      const feeds: string[] = [];
      const fedBy: string[] = [];
      const hops: Reason[] = [];
      const feedWeight = new Map<string, number>();
      const links: CardLink[] = [];
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
        hops.push(...found);
        links.push({ feeds: out, fedBy: into, commander: commanders.has(name) });
        if (out.length > 0) { feeds.push(name); feedWeight.set(name, maxAxisWeight(out, axis)); }
        if (into.length > 0) fedBy.push(name);
        connections.push(name);
        onPlan += maxAxisWeight(found, axis);
        const names = [...new Set([name, ...faceDeckCards(x).map((f) => f.card.name)])].sort((a, b) => b.length - a.length);
        for (const r of found) {
          const key = `${r.tag}\u0000${names.reduce((t, n) => t.split(n).join("\u0001"), r.text)}`;
          const had = byShape.get(key);
          if (!had) {
            const fresh: SuggestedReason = { text: r.text, others: [] };
            byShape.set(key, { reason: fresh, first: name });
            reasons.push(fresh);
          } else if (had.first !== name && !had.reason.others.includes(name)) had.reason.others.push(name);
        }
      }
      if (connections.length === 0) return null;
      return { card: suggestedCard(candidate, y, connections, reasons), onPlan, score: 0, feeds, fedBy, feedWeight, hops, strength: cardStrength(links, weights, axis) };
    } catch (err) {
      console.warn("[suggest] the engine could not read", candidate.name, err);
      return null;
    }
  }
}

/** The card as a list shows it, with the engine's findings when it has any. */
function suggestedCard(candidate: IndexCard, y: DeckCard, connections: string[], reasons: SuggestedReason[]): SuggestedCard {
  const oracle = y.card.oracleText;
  // `card` is the corpus document spread under the engine card (`deckCards` above), so its art
  // is on it: card-level for most cards, per face for a transform or modal two-faced card.
  const doc = y.card as { artCrop?: string; faces?: { artCrop?: string }[] };
  const art = doc.artCrop ?? doc.faces?.find((f) => f.artCrop)?.artCrop;
  return { name: candidate.name, slug: candidate.slug, identity: candidate.identity, mv: candidate.mv, connections, reasons, ...(oracle ? { oracle } : {}), ...(art ? { art } : {}) };
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
  /** The cuts to pair adds against, weakest first, by physical name. Absent, the report's own
   *  `cutList`. The page's cut list is not the report's: it also offers trade-offs (a weak card with
   *  something arguing for it), and on the Party Time precon the report's list was empty while the
   *  page proposed three, so no cut had a card to take its slot (baseline round, 2026-09-26). */
  cuts?: readonly string[];
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
  const raw = deckCards(lookup);
  const rawDeck = (await Promise.all(physical.map(raw))).filter((x): x is DeckCard => x !== null);
  // A CHOSEN TYPE IS THIS DECK'S TYPE, resolved as the report resolves it (`analyze.ts`): read
  // unresolved, Inalla's Kindred Discovery "drew a card" for every creature in the corpus and
  // filled the plan list with Ogres (persona round 2026-09-25). A candidate resolves against the
  // same deck counts, since the question is what it does in THIS deck.
  const counts = deckSubtypeCounts(rawDeck);
  const hierarchy = loadHierarchy();
  // AND THE COMMANDER IS MARKED, the other half of the report's deck pass: without it a "whenever
  // your commander ..." candidate joined nothing and dropped out of every list (final review, AO4).
  const commanderNames = new Set(report.cards.filter((c) => c.isCommander).map((c) => c.cardName ?? c.name));
  // And a shared type resolves to the commanders' types, as the report resolves it (#559).
  const sharedWith = commanderSubtypes(rawDeck.filter((d) => commanderNames.has(d.card.name)).map((d) => d.tags));
  const resolve = (d: DeckCard | null): DeckCard | null => {
    if (!d?.tags) return d;
    const tags = resolveSharedTypes(resolveChosenTypes(d.tags, counts, hierarchy), sharedWith);
    return { ...d, tags: commanderNames.has(d.card.name) ? markCommander(tags) : tags };
  };
  const dc = async (name: string) => resolve(await raw(name));
  const deckDcs = rawDeck.map((d) => resolve(d)!);

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
    .map((g) => {
      const n = g.target - g.count + SPARES;
      return [g.name, shortlist(gapList(pool, g.leaves, g.costBand, Infinity), n * SHORTLIST, g.costBand), n, g.costBand, stapleList(index, g.leaves, g.costBand, n, admissible)] as const;
    });
  const answersRanked = (report.deckMath?.answers ?? [])
    // ONLY A CLASS WITH NO ANSWER AT ALL, the one the page's finding names (owner, 2026-09-26: the
    // five-per-kind target asked every deck for answers). One card fills it; the spares give a choice.
    .filter((a) => a.class !== "graveyard" && a.class !== "land" && a.count === 0 && !a.fromCommandZone)
    .map((a) => [a.class, shortlist(answerList(pool, a.class, interactionBand, Infinity), (ANSWER_ADDS + SPARES) * SHORTLIST, interactionBand), ANSWER_ADDS + SPARES, interactionBand] as const);
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
  // A CUT'S CONNECTIONS come from the ranked trim order, which rows every cuttable card; the
  // report's `cutList` rows only the ones nothing argues for.
  const rowOf = new Map([...(report.trim ?? []), ...(report.cutList ?? [])].map((r) => [r.name, r] as const));
  const cuts: CutSide[] = (input.cuts ?? (report.cutList ?? []).map((r) => r.name)).map((name) => ({
    name,
    roles: report.cards.find((c) => (c.cardName ?? c.name) === name)?.roles ?? [],
    connections: rowOf.get(name)?.partners ?? 0,
    manaValue: rowOf.get(name)?.manaValue,
  }));
  // ONE PREFETCH FOR EVERY CANDIDATE THAT MIGHT BE SHOWN, so verification reads a warm lookup.
  const shown = unique([
    ...planRanked, ...buildRanked.flatMap(([, l]) => l), ...answersRanked.flatMap(([, l]) => l),
    ...synergyRanked.flatMap(([, l]) => l),
  ].map((c) => c.card.name).concat(buildRanked.flatMap(([, , , , st]) => st.map((c) => c.name))));
  await lookup.prefetch(shown.map(normalizeName));
  const verify = verifier(dc, deckLandTypes(deckDcs), axis, commanderNames, loadImpactWeights());
  const nonland = physical.filter((n) => !atName.get(n)?.isLand);
  // AN UNREADABLE CARD IS LEFT TO `verify`, which drops it and says so.
  const harmsDeck = (name: string): Promise<boolean> => dc(name).then((d) => killsOwnCreatures(d?.tags, d?.card.oracleText), () => false);

  // A SWAP'S ADD MUST DO MORE FOR THIS DECK THAN ITS CUT, BY THE REPORT'S OWN MEASURE (owner,
  // 2026-10-01): both are read the same way, against the deck without the cut, and weighed by the
  // per-card formula the report rates cards with (`card-strength.ts`) -- links on the deck's theme
  // and links with the commander count for more. A distinct-partner count let thirteen off-theme
  // links outrank nine on it. Each cut asks the first `SHORTLIST` of its list and keeps the
  // strongest add that beats it; a card that kills its own creatures, or that the engine joins to
  // nothing, is passed over for the next.
  const without = (cut: string) => nonland.filter((n) => n !== cut);
  const cutReads = new Map<string, Promise<Strength>>();
  const cutStrength = (name: string): Promise<Strength> => {
    let p = cutReads.get(name);
    if (!p) cutReads.set(name, p = verify(deckIndexCard(name), without(name), false).then((v) => v?.strength ?? NO_STRENGTH));
    return p;
  };
  const chosen = new Map<string, Verified>();
  const pairsRanked = await pairReplacements(cuts, groups, pool, planRanked, async (cut, list) => {
    const before = (await cutStrength(cut.name)).strength;
    let best: { c: Candidate; v: Verified } | undefined;
    for (const c of list.slice(0, SHORTLIST)) {
      if (await harmsDeck(c.card.name)) continue;
      const v = await verify(c.card, without(cut.name), false);
      if (!v) { console.warn("[suggest] stale pair: the engine draws nothing for", c.card.name); continue; }
      if (v.strength.strength > before && (!best || v.strength.strength > best.v.strength.strength)) best = { c, v };
    }
    if (best) chosen.set(cut.name, best.v);
    return best?.c;
  });

  const out: DeckSuggestions = { build: {}, answers: {}, synergy: {}, plan: [], pairs: [], routes: [] };
  // WHAT EACH CARD COUNTS AS, on the row: the finding names the group, and the row has to say this
  // card is one of them before its connections argue it is the right one.
  //
  // A STAPLE LEADS THE LIST (owner ruling 2026-09-27, #534): the tuner offered Carnival of Souls, The
  // Sackville-Bagginses, Starting Column and Howlsquad Heavy would take none of them and "go find
  // 2-mana rocks myself". Staple-grade cards the engine joins come first with their reasons, then
  // the staples it does not, then the synergy-only picks.
  const isStaple = (c: SuggestedCard): boolean => (atName.get(c.name)?.grade ?? 0) > 0;
  for (const [name, list, limit, band, staples] of buildRanked) {
    const joined = await verified(list, limit, verify, nonland, band);
    const plain: SuggestedCard[] = [];
    for (const st of staples) {
      if (joined.some((c) => c.name === st.name)) continue;
      // ONE CARD'S UNREADABLE DATA DROPS THAT CARD, as in `verifier`: a throw here would reject every list.
      try {
        const y = await dc(st.name);
        if (y) plain.push(suggestedCard(st, y, [], []));
      } catch (err) {
        console.warn("[suggest] the engine could not read", st.name, err);
      }
    }
    // NO STAPLES, NO REORDER: only a ramp group gets any, and a graded card on another list is there
    // for that list's job.
    const ordered = staples.length > 0 ? [...joined.filter(isStaple), ...plain, ...joined.filter((c) => !isStaple(c))] : joined;
    out.build[name] = ordered.slice(0, limit).map((c) => ({ ...c, fills: name }));
  }
  for (const [cls, list, limit, band] of answersRanked) out.answers[cls] = (await verified(list, limit, verify, nonland, band)).map((c) => ({ ...c, answers: [cls] }));
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
    const add = chosen.get(p.cut)!;
    const cutS = await cutStrength(p.cut);
    out.pairs.push({ cut: p.cut, add: { ...add.card }, rule: p.rule, counts: p.counts, cutConnections: cutS.partners, cutStrength: cutS, addStrength: add.strength });
  }
  // THE BIGGEST GAIN FIRST: the precon package takes its synergy swaps in this order.
  const gain = (p: SuggestedPair) => p.addStrength.strength - p.cutStrength.strength;
  out.pairs.sort((a, b) => gain(b) - gain(a));

  // ONE CARD, ONE PLACE: a card a finding already names leaves the plan list and says so there.
  const planSafe: Candidate[] = [];
  for (const c of planRanked) if (!(await harmsDeck(c.card.name))) planSafe.push(c);
  const plan = await verified(planSafe, PLAN_LIMIT * 2, verify, nonland, ANY_BAND, 2);
  const onFindings = [...Object.values(out.build), ...Object.values(out.answers), ...Object.values(out.synergy)].flat();
  const planNames = new Set(plan.map((c) => c.name));
  for (const c of onFindings) if (planNames.has(c.name)) c.alsoPlan = true;
  const taken = new Set(onFindings.map((c) => c.name));
  const planLeft = plan.filter((c) => !taken.has(c.name));

  // ROUTES: a bridge is rarely on the axis itself (Impact Tremors joins thirty token makers to
  // Ghyrson through "a creature enters", weight ~0) and rarely in `pi` -- its event is asked by two
  // thousand cards, so every list keeps the same sixteen (Tremors: 1 `pi` connection, 31 real, the
  // witness deck 2026-09-25). So its shortlist comes from the event index: a card that ASKS for one
  // of the deck's most-supplied events and CAUSES one the deck asks for, ordered by how many deck
  // cards supply what it asks. The engine then names the route.
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
  // EXACT ROUTES (spec 2026-09-25): a source reaches a target through this card only if a route
  // exists WITH its reasons and none without -- continuous through the same ability at every hop.
  // Deck reasons are the report's own edges. A direct edge is a route too, so it is never "opened".
  // ONE INDEX FOR THE DECK, extended per candidate: many searches ask of one deck (final review).
  const deckRoutes = indexRoutes((report.edges ?? []).flatMap((e) => e.reasons ?? []));
  const reachesAlready = new Map<string, boolean>();
  const already = (a: string, b: string): boolean => {
    const k = `${a}\u0000${b}`;
    if (!reachesAlready.has(k)) reachesAlready.set(k, findRoutes(deckRoutes, a, b).length > 0);
    return reachesAlready.get(k)!;
  };
  for (const c of routeRanked) {
    if (await harmsDeck(c.name)) continue;
    const v = await verify(c, nonland, false);
    if (!v) continue;
    const all = extendRoutes(deckRoutes, v.hops);
    let best: { to: string; from: string[]; chain: RouteHop[]; worth: number } | null = null;
    for (const to of [...v.feeds].sort((a, b) => a.localeCompare(b, "en"))) {
      const from: string[] = [];
      let chain: RouteHop[] | null = null;
      for (const s of v.fedBy) {
        if (s === to || already(s, to)) continue;
        const found = findRoutes(all, s, to).find((r) => r.hops.some((h) => h.from === c.name || h.to === c.name));
        if (!found) continue;
        from.push(s);
        if (!chain || found.hops.length < chain.length) chain = found.hops;
      }
      const worth = from.length * (v.feedWeight.get(to) ?? 0);
      if (chain && worth > 0 && (!best || worth > best.worth || (worth === best.worth && from.length > best.from.length))) {
        best = { to, from, chain, worth };
      }
    }
    if (best) routes.push({ card: { ...v.card, route: { to: best.to, from: best.from, chain: best.chain } }, n: best.worth });
  }


  // ONE CARD, ONE PLACE, THREE TIERS (spec §3, amended 2026-09-25): finding > route > plan. A bridge
  // a finding already names stays on the finding; a route card leaves the plan list, whose verified
  // spares (it verifies twice PLAN_LIMIT) fill the room it leaves.
  out.routes = routes.filter((r) => !taken.has(r.card.name))
    .sort((a, b) => b.n - a.n || a.card.mv - b.card.mv || a.card.name.localeCompare(b.card.name, "en"))
    .slice(0, ROUTE_LIMIT).map((r) => r.card);
  const onRoutes = new Set(out.routes.map((c) => c.name));
  out.plan = planLeft.filter((c) => !onRoutes.has(c.name)).slice(0, PLAN_LIMIT);
  return out;
}
