import {
  COMMANDER_BOOST,
  rankThemes,
  computeCohesion,
  loadImpactWeights,
  impactEdgeWeight,
  computeDeckStats,
  computeSynergyRatings,
  ComboIndex,
  type Combo,
  type DeckReport,
  type SynergyEdge,
  type CardSynergy,
  type Reason,
  type TagStats,
  type ImpactWeights,
} from "@mtg/engine";
import type { CardTags } from "@mtg/tagger";
import type { DeckCard, Hierarchy } from "./types.js";
import { loadHierarchy } from "./hierarchy.js";
import { pairReasons, cardThemeTags, cardCaresTags, directedReasons, createsReasons, createsForYou, claimCount, ROLE_NOT_SYNERGY } from "./edges.js";
import { createdTokenRefs, type TokenRef } from "./tokens.js";
import { markCommander } from "./commander.js";
import { deckSubtypeCounts, resolveChosenTypes } from "./chosen-type.js";
import { computeCardBuckets } from "./buckets.js";
import { groupEdgesByArchetype } from "./mechanisms.js";
import { buildAxis, maxAxisWeight } from "./axis.js";
import { makeFold } from "./theme-fold.js";
import { magnitudeMultipliers } from "./magnitude.js";
import { buildSupplyDemand } from "./supply-demand.js";
import { detectArchetypes } from "./archetypes.js";
import { computeBuild, detectBuildCategories, rolesByCard, doubleDutyRating } from "./build.js";
import { cutCandidates, deckSlack } from "./cut-list.js";
import { computeDeckMath } from "./deck-math.js";
import { loadThemeStats } from "./theme-stats.js";
import { themeMembership, themeCandidates } from "./themes.js";
import { promoteSpecificHeadline } from "./theme-promote.js";
import { rankThemesByLoop } from "./theme-loop.js";

/**
 * Structured-engine counterpart of `@mtg/engine`'s `analyzeDeck`: same `DeckReport` shape,
 * but edges come from oracle-text-derived structured tags (producer emits / consumer
 * triggers, static-effect subjects) instead of the flat produces/cares tag vocabulary.
 *
 * `combos` is populated from an optional `ComboIndex` (empty when none is supplied) and theme
 * ranking uses a uniform TagStats (deck-frequency-only; no global IDF corpus yet).
 */
const RAMP_EFFECT_KINDS = new Set(["mana-generation", "fast-mana", "ritual"]);
const REMOVAL_EFFECT_KINDS = new Set(["damage", "forced-sacrifice"]);

/** Type-line land detection, shared by the nonland-card map and the nonland count so both stay
 *  in sync. */
const isLand = (dc: DeckCard): boolean => dc.card.typeLine.toLowerCase().includes("land");

/** Best-effort structured proxy for the flat engine's ramp/draw/removal role counts. Counts
 *  distinct cards, not abilities. Removal is approximated as damage/forced-sacrifice effects
 *  targeting the opponent's side — the structured schema has no dedicated destroy/exile kind. */
function computeRoles(cards: DeckCard[]): { ramp: number; draw: number; removal: number } {
  let ramp = 0;
  let draw = 0;
  let removal = 0;
  for (const dc of cards) {
    if (!dc.tags) continue;
    let hasRamp = false;
    let hasDraw = false;
    let hasRemoval = false;
    for (const a of dc.tags.abilities) {
      if (RAMP_EFFECT_KINDS.has(a.effect.kind)) hasRamp = true;
      if (a.effect.kind === "draw-card") hasDraw = true;
      if (REMOVAL_EFFECT_KINDS.has(a.effect.kind) && a.effect.subject?.control === "opp") hasRemoval = true;
    }
    if (hasRamp) ramp++;
    if (hasDraw) draw++;
    if (hasRemoval) removal++;
  }
  return { ramp, draw, removal };
}

/** Build the synthetic node for a token derivation row -- a `DeckCard`-shaped entry the pair loop
 *  can walk exactly like a real card, carrying the token's OWN derived characteristics and
 *  abilities. Only the fields `Card` requires are synthesized; the rest (mana cost, produced mana,
 *  ...) genuinely do not apply to a permanent that is never cast. */
function tokenDeckCard(ref: TokenRef, tags: CardTags): DeckCard {
  const c = tags.characteristics;
  return {
    card: { name: ref.name, typeLine: ref.typeLine, oracleText: "", keywords: c.keywords, colors: c.colors, manaValue: 0 },
    tags,
    isToken: true,
  };
}

/** Every token node a deck can make, plus the two directions of the maker relation. Exported
 *  because the GRAPH PROJECTION needs the identical node list: `projectDeckGraph` builds its nodes
 *  off the deck array it is given and drops a reason naming anything else as `offDeckReasons`, so a
 *  server that fed it only real cards would throw away every token edge this function's nodes
 *  earned. One fact, one path -- the caller re-deriving the dedupe is how the two lists drift. */
export function collectTokenNodes(
  deck: DeckCard[],
  tokenTags: (ref: TokenRef) => CardTags | null,
): {
  nodes: DeckCard[];
  /** card name -> the oracleIds of the tokens it structurally creates. */
  producerTokenOracles: Map<string, Set<string>>;
  /** token oracleId -> the card name(s) that make it. */
  tokenCreators: Map<string, Set<string>>;
} {
  const nodes: DeckCard[] = [];
  const producerTokenOracles = new Map<string, Set<string>>();
  const tokenCreators = new Map<string, Set<string>>();
  const byOracle = new Map<string, DeckCard>();
  for (const dc of deck) {
    for (const ref of createdTokenRefs(dc.card)) {
      const tags = tokenTags(ref);
      if (!tags) continue; // unresolved -- refuse, never fall back to a (name, typeLine) lookup
      if (!byOracle.has(tags.oracleId)) {
        const node = tokenDeckCard(ref, tags);
        byOracle.set(tags.oracleId, node);
        nodes.push(node);
      }
      let oracles = producerTokenOracles.get(dc.card.name);
      if (!oracles) producerTokenOracles.set(dc.card.name, (oracles = new Set()));
      oracles.add(tags.oracleId);
      let creators = tokenCreators.get(tags.oracleId);
      if (!creators) tokenCreators.set(tags.oracleId, (creators = new Set()));
      creators.add(dc.card.name);
    }
  }
  return { nodes, producerTokenOracles, tokenCreators };
}

export function analyzeDeckStructured(
  inputs: DeckCard[],
  commanderNames?: string[],
  hierarchy: Hierarchy = loadHierarchy(),
  impactWeights: ImpactWeights = loadImpactWeights(),
  combos?: ComboIndex,
  themeStats: TagStats = loadThemeStats(),
  // Optional so every existing caller (~15: bins, the web server, the CLI) keeps working unchanged.
  // A caller that wants tokens on the graph supplies a lookup backed by the 94 rows Task 5 derived
  // into `cardTagsDerived` -- resolve via `tokens.findOne({printingIds: ref.printingId})` then
  // `cardTagsDerived.findOne({oracleId: tokenDoc._id})`, and return null (never a name lookup) when
  // either step misses.
  tokenTags?: (ref: TokenRef) => CardTags | null,
): DeckReport {
  const commanderSet = new Set(commanderNames ?? []);

  // Deck-aware passes, applied once before any edge formation. Chosen types resolve against what the
  // deck actually runs; the commander stamp marks WHICH cards the list designated, which is the only
  // way `SubjectFilter.commander` can ever be satisfied — see commander.ts.
  const counts = deckSubtypeCounts(inputs);
  const resolved: DeckCard[] = inputs.map((dc) => {
    if (!dc.tags) return dc;
    const tags = resolveChosenTypes(dc.tags, counts, hierarchy);
    return { card: dc.card, tags: commanderSet.has(dc.card.name) ? markCommander(tags) : tags };
  });

  // ONE NODE PER CARD, WITH ITS COUNT (owner's ruling, 2026-08-15). `parseDecklistSections` expands
  // "6 Plains" into six entries, so the pair loop was producing six identical Farseek->Plains edges
  // and the graph six identical nodes. Measured across the 71 decks: 12.2% of card slots are
  // duplicate copies, and they carried 3,628 duplicate edges — 10.9% of the population.
  //
  // Deduped ONLY here, for the relations. `computeDeckMath` keeps the FULL list below, because every
  // figure it produces is a probability over a 100-card library and collapsing basics would silently
  // turn it into a 65-card deck. `deckFreq` keeps the full list too: theme frequency asks how much of
  // the deck carries a tag, which is a question about slots and not about distinct cards.
  const byName = new Map<string, { card: DeckCard; copies: number }>();
  for (const dc of resolved) {
    const seen = byName.get(dc.card.name);
    if (seen) seen.copies++;
    else byName.set(dc.card.name, { card: dc, copies: 1 });
  }
  const unique = [...byName.values()].map((v) => v.card);
  const quantities = Object.fromEntries([...byName].filter(([, v]) => v.copies > 1).map(([n, v]) => [n, v.copies]));

  // TOKEN NODES (Task 6, tokens-as-nodes). Structural, not inferred: `createdTokenRefs` is the EXACT
  // card->token link (a printing id against `tokens.printingIds`, Task 3/4a), so which token a card
  // makes is a fact, never a subject-matching guess. Deduped on the token's own `oracleId` -- several
  // makers of "Treasure" in one deck must share ONE node, not one each. `producerTokenOracles` is the
  // gate `createsReasons` needs: restricting it to AUTHORED emits means an untyped one (rare) could
  // still wildcard onto a token this card never actually makes, unless the pair loop below only ever
  // asks the question for a (maker, token-it-structurally-creates) pair in the first place.
  // `tokenCreators` is the reverse of `producerTokenOracles` -- oracleId -> the card name(s) that
  // make it. It feeds `tokenNodesReport` below: a token's "creator" set is what a partnering edge
  // must NOT be to count (an edge back to your own maker is not a partner, see that block).
  const { nodes: tokenNodes, producerTokenOracles, tokenCreators } = tokenTags
    ? collectTokenNodes(unique, tokenTags)
    : { nodes: [] as DeckCard[], producerTokenOracles: new Map<string, Set<string>>(), tokenCreators: new Map<string, Set<string>>() };

  // Pairwise edges over unordered pairs; i < j guarantees no self-pair and no double-count
  // (pairReasons already unions both directions for a given {a,b}).
  //
  // Token nodes ride along ONLY here -- the array this loop walks -- and nowhere below: not
  // `computeDeckMath`, `deckFreq`, `computeRoles`, `detectBuildCategories` or `ratedCards`, all of
  // which stay on `unique`/`resolved`. Every figure those produce is a probability over a 100-card
  // library, and a token is never drawn. `pairPool` puts every token AFTER every real card, so for
  // i < j a (real, token) cross-pair always has the real card at `i` -- exactly the shape
  // `createsReasons` demands.
  const pairPool: DeckCard[] = [...unique, ...tokenNodes];
  const edges: SynergyEdge[] = [];
  // FINDINGS 1/2 (owner review, 2026-08-16), FIXED PROPERLY on re-review (2026-08-16): the first cut
  // rebuilt this filter AFTER the fact by matching `edge.a`/`edge.b` against a set of token NAMES --
  // wrong, because names are not unique. 10 of the 71 calibration decks run a real card whose name
  // matches a token it creates (e.g. a card named "Treasure" alongside the Treasure token), and the
  // name filter silently dropped that real card's edges from `report.archetypes[].cards` and
  // `themeMembership`, same failure class as the leak it replaced but worse -- data loss with no
  // error, instead of a cosmetic extra entry.
  //
  // Fixed by tagging IDENTITY at the point each edge is created, where `a.isToken`/`b.isToken` are
  // still the actual node objects and cannot collide: `cardEdges` collects only the pairs where
  // NEITHER side is a token node, built alongside `edges` in the same loop rather than reconstructed
  // from it afterward. `report.edges` keeps every token edge, for the graph.
  const cardEdges: SynergyEdge[] = [];
  for (let i = 0; i < pairPool.length; i++) {
    for (let j = i + 1; j < pairPool.length; j++) {
      const a = pairPool[i], b = pairPool[j];
      const reasons = pairReasons(a, b, hierarchy);
      if (b.isToken && producerTokenOracles.get(a.card.name)?.has(b.tags!.oracleId)) {
        reasons.push(...createsReasons(a, b, hierarchy));
      }
      if (reasons.length > 0) {
        const edge = { a: a.card.name, b: b.card.name, score: claimCount(reasons), reasons };
        edges.push(edge);
        if (!a.isToken && !b.isToken) cardEdges.push(edge);
      }
    }
  }
  edges.sort((x, y) => y.score - x.score);

  // A TOKEN PARTNERS WHEN SOMETHING BEYOND ITS OWN MAKER RELATES TO IT (owner's ruling, presentation
  // task). Scanned off `edges` -- the array already carries every token-touching pair, both the
  // maker's own `creates:` edge (Task 6) and whatever a payoff forms with the token directly (Task
  // 7's mediation). A Treasure that only ever edges back to a card in `tokenCreators.get(oracleId)`
  // (its own maker(s)) is unpartnered -- "this deck makes Clues and nothing cares" is a real
  // deckbuilding fact, not noise, which is why it stays IN the data (below) even though the default
  // view will hide it.
  const tokenOracleByName = new Map(tokenNodes.map((dc) => [dc.card.name, dc.tags!.oracleId] as const));
  const partneredOracles = new Set<string>();
  for (const edge of edges) {
    const aOracle = tokenOracleByName.get(edge.a);
    if (aOracle && !tokenCreators.get(aOracle)?.has(edge.b)) partneredOracles.add(aOracle);
    const bOracle = tokenOracleByName.get(edge.b);
    if (bOracle && !tokenCreators.get(bOracle)?.has(edge.a)) partneredOracles.add(bOracle);
  }
  const tokenNodesReport = tokenNodes.map((dc) => ({
    name: dc.card.name,
    hasPartner: partneredOracles.has(dc.tags!.oracleId),
  }));

  // Deck-local frequency of theme tags (cards whose abilities carry the tag).
  const deckFreq = new Map<string, number>();
  for (const dc of resolved) {
    if (!dc.tags) continue;
    for (const tag of cardThemeTags(dc.tags)) deckFreq.set(tag, (deckFreq.get(tag) ?? 0) + 1);
  }

  // The deck's strategy axis — commander theme tags (anchor) widened by dominant deck themes.
  const commanderThemeTags = new Set<string>();
  for (const dc of resolved) {
    if (dc.tags && commanderSet.has(dc.card.name)) {
      for (const tag of cardThemeTags(dc.tags)) commanderThemeTags.add(tag);
    }
  }
  const axis = buildAxis(commanderThemeTags, deckFreq, themeStats);
  const AXIS_BOOST = 1.5; // tunable: a fully on-axis edge counts 2.5x an off-axis one.
  const AXIS_ON_THRESHOLD = 0.25; // tunable: min axis weight for an edge to count on-axis (calibrated).
  const FEEDER_SHARE = 0.25; // tunable: a feeder gets this share of a payoff-edge's weight (√-damped).
  const ROLE_BLEND = impactWeights.roleBlend ?? 1; // config, not a constant: see spec §3.1

  // Axis / coverage pass (undirected — unchanged semantics).
  const onAxisCards = new Set<string>();
  const bestAxisWeight = new Map<string, number>();
  for (const edge of edges) {
    const maxW = maxAxisWeight(edge.reasons, axis);
    if (maxW >= AXIS_ON_THRESHOLD) { onAxisCards.add(edge.a); onAxisCards.add(edge.b); }
    bestAxisWeight.set(edge.a, Math.max(bestAxisWeight.get(edge.a) ?? 0, maxW));
    bestAxisWeight.set(edge.b, Math.max(bestAxisWeight.get(edge.b) ?? 0, maxW));
  }

  // Directional aggregation: for each directed edge p→c (p FEEDS payoff c), the payoff accrues the
  // full edge weight (it is the sink); the feeder accrues a β share. Both are √-damped (concave):
  // an anchor rises with its support instead of being flattened toward the mean of its feeders (the
  // old dampByAlpha ÷partnerCount behavior). A card that both feeds and is fed earns both terms.
  // ponytail: directedReasons(p,c) re-runs the O(n²) reason computation vs. the undirected `edges`
  // build above — acceptable at deck scale (~100 cards); a future pass could build directed and
  // undirected reasons together in one O(n²) sweep instead of two.
  interface Dir { support: number; feederSum: number; partnerCount: number; partners: { name: string; contribution: number; reasons: Reason[] }[] }
  const dir = new Map<string, Dir>();
  // Deduped for the same reason the undirected loop above is: six copies of a basic contributed six
  // times to every partner's support, inflating per-card ratings by however many copies the deck ran.
  for (const dc of unique) dir.set(dc.card.name, { support: 0, feederSum: 0, partnerCount: 0, partners: [] });

  // THE RATINGS PASS WALKS THE SAME TWO HOPS THE GRAPH DOES (2026-08-18). Task 7 made tokens
  // MEDIATE -- a maker no longer edges straight to a token payoff, it edges to the token and the
  // token edges to the payoff -- but this loop iterates `unique`, the real cards, so a relation that
  // now lives on a token node was invisible to it. Measured before the fix: 100 cards across the 71
  // decks had ZERO directed partners while carrying token edges, 43 of them having had partners
  // before mediation, the worst being Caretaker's Talent ("whenever one or more tokens you control
  // enter, draw a card") at 30 partners -> 0 in `naya-spellslinger` -- a token payoff reading as
  // synergising with nothing in a token deck. A wrong sentence, not a missing one.
  //
  // The fix is TRAVERSAL, not a second copy of the fact: the reasons still live on the token edges
  // and this pass borrows them for the pair they connect. Both directions are walked, because both
  // were direct edges before mediation -- maker -> token -> payoff (Empty the Warrens feeding
  // Caretaker's Talent) and buff -> token -> maker (an anthem on Soldiers relating to what makes
  // Soldiers).
  //
  // MERGED INTO THE PAIR'S DIRECT REASONS, NOT CREDITED SEPARATELY, and that is what keeps it from
  // inflating: `impactEdgeWeight` takes the max per distinct tag, so a maker whose four token types
  // all satisfy one `enters:any` trigger scores that tag ONCE -- exactly as the single direct edge
  // did before. A separate credit per token would have paid it four times.
  const hopKey = (p: string, c: string): string => `${p} -> ${c}`;
  const twoHopReasons = new Map<string, Reason[]>();
  // THE MEMBERSHIP CENSUS IS TOKEN-BLIND WITHOUT THIS (roadmap A2). `allReasons` below is built from
  // `cardEdges`, which excludes every edge touching a token -- correctly, since a token is not a card
  // in the deck -- so a token deck's whole plan sits on exactly the excluded edges and
  // `themeMembership` reads a surplus/payoff split that is missing it. The same two hops the ratings
  // pass walks are re-stamped onto the REAL cards at their ends and handed to the census. Not a
  // second copy of the fact: these Reasons never reach `report.edges`, `report.archetypes` or the
  // graph, only the census.
  const twoHopCensusReasons: Reason[] = [];
  const addHop = (p: string, c: string, reasons: Reason[]): void => {
    if (reasons.length === 0 || p === c) return; // a card does not feed itself through its own token
    const existing = twoHopReasons.get(hopKey(p, c));
    if (existing) existing.push(...reasons);
    else twoHopReasons.set(hopKey(p, c), [...reasons]);
    for (const r of reasons) {
      twoHopCensusReasons.push({
        ...r,
        producer: p,
        consumer: c,
        producerIsToken: undefined,
        consumerIsToken: undefined,
        // A token's own `enters` is IMPLIED -- the token existing supplies it -- but the CARD at the
        // producing end of the hop authored it by making the token, so for the card the supply is
        // surplus, not baseline. Only re-stamp the direction whose producer was the token.
        impliedProducer: r.producerIsToken ? undefined : r.impliedProducer,
      });
    }
  };
  const uniqueByName = new Map(unique.map((dc) => [dc.card.name, dc] as const));
  for (const t of tokenNodes) {
    const makers = tokenCreators.get(t.tags!.oracleId);
    if (!makers) continue;
    // WHO GETS THE TOKEN DECIDES WHETHER THE HOP EXISTS. Beast Within and Generous Gift hand their
    // Beast/Elephant to the permanent's CONTROLLER -- an opponent -- and a payoff reads "tokens YOU
    // control", so crediting them would state a synergy the card cannot supply. Caught by measuring:
    // the first cut lifted Beast Within and Generous Gift from 0 to 2.0 in `naya-spellslinger`, which
    // is exactly the case CLAUDE.md already flags as why `isolated-cards.ts` reads as an upper bound.
    const ourMakers = [...makers].filter((m) => {
      const maker = uniqueByName.get(m);
      return maker !== undefined && createsForYou(maker, t, hierarchy);
    });
    if (ourMakers.length === 0) continue;
    for (const other of unique) {
      const name = other.card.name;
      const tokenFeeds = directedReasons(t, other, hierarchy); // token -> card
      const feedsToken = directedReasons(other, t, hierarchy); // card -> token
      for (const maker of ourMakers) {
        addHop(maker, name, tokenFeeds);
        addHop(name, maker, feedsToken);
      }
    }
  }

  // THE MAGNITUDE DISCOUNT (spec 2026-08-18). Computed ONCE per deck off the same undirected
  // `edges` reasons the pass below re-derives directionally, so the ratio a card is judged against
  // is the deck's whole claim population and not the pair's. `beta: 0` (the shipped default)
  // makes `magnitudeMultipliers` return empty maps -- but gate the CENSUS itself on beta > 0, not
  // just its output, so "ships inert" is literally true: every analyze() call was building the
  // whole supply:demand census (an O(reasons) pass over the deck) and throwing it away.
  const magOpts = impactWeights.magnitude;
  const mag = magOpts && magOpts.beta > 0
    ? magnitudeMultipliers(
        buildSupplyDemand(
          edges.flatMap((e) => e.reasons),
          // `resolved`, every physical copy -- not `unique` (deduped by name). `library` inside
          // `buildSupplyDemand` is `inputs.filter(!isCommander).length`, and you draw from real
          // copies: a 30-basic deck has ~70 DISTINCT non-commander names but 99 real cards, a ~40%
          // undercount of the library `pDrawn` divides by. `byName` in there already dedupes for
          // the shape of the row, so array length is the only thing this changes.
          resolved.map((dc) => ({
            name: dc.card.name,
            tags: dc.tags ?? null,
            isCommander: commanderSet.has(dc.card.name),
          })),
        ),
        magOpts,
      )
    : { feeder: new Map<string, number>(), payoff: new Map<string, number>() };

  for (let i = 0; i < unique.length; i++) {
    for (let j = 0; j < unique.length; j++) {
      if (i === j) continue;
      const p = unique[i], c = unique[j];
      const hop = twoHopReasons.get(hopKey(p.card.name, c.card.name));
      const direct = directedReasons(p, c, hierarchy); // p feeds c
      const reasons = hop ? [...direct, ...hop] : direct;
      if (reasons.length === 0) continue;
      const maxW = maxAxisWeight(reasons, axis);
      const axisBoost = 1 + AXIS_BOOST * maxW;
      // Two weights, not one: the discount belongs to the crowded side. A supply-glutted tag cuts
      // what the FEEDER earns for supplying it and leaves the payoff's support alone; a
      // demand-glutted tag does the mirror.
      const wPayoff = impactEdgeWeight(reasons, impactWeights, (tag) => mag.payoff.get(tag) ?? 1) * axisBoost;
      const wFeeder = impactEdgeWeight(reasons, impactWeights, (tag) => mag.feeder.get(tag) ?? 1) * axisBoost;
      // Commander boost: credit is amplified when the OTHER endpoint is the commander (mirrors the
      // old boostForA/boostForB semantics).
      const payoffBoost = commanderSet.has(p.card.name) ? COMMANDER_BOOST : 1;
      const feederBoost = commanderSet.has(c.card.name) ? COMMANDER_BOOST : 1;
      const cAgg = dir.get(c.card.name)!;
      const pAgg = dir.get(p.card.name)!;
      cAgg.support += wPayoff * payoffBoost;
      cAgg.partnerCount += 1;
      cAgg.partners.push({ name: p.card.name, contribution: wPayoff * payoffBoost, reasons });
      pAgg.feederSum += FEEDER_SHARE * wFeeder * feederBoost;
      pAgg.partnerCount += 1;
      pAgg.partners.push({ name: c.card.name, contribution: FEEDER_SHARE * wFeeder * feederBoost, reasons });
    }
  }
  const authorityByName = new Map<string, number>();
  for (const [name, d] of dir) authorityByName.set(name, Math.sqrt(d.support));

  const presentCommanders = resolved.map((dc) => dc.card.name).filter((n) => commanderSet.has(n));
  const deckNames = new Set(resolved.map((dc) => dc.card.name));
  const foundCombos: Combo[] = combos?.combosContainedIn(deckNames) ?? [];
  const comboCardNames = new Set(foundCombos.flatMap((c) => c.cards));
  const tagsByName = new Map(resolved.map((dc) => [dc.card.name, dc.tags] as const));

  const VERSATILITY_STEP = 0.15;
  const COMBO_BONUS = 1.5;
  const WIN_CON_AUTHORITY_WEIGHT = 1.0; // tunable: how much a well-fed anchor's authority reads as win-con.
  const maxAuthority = Math.max(0, ...authorityByName.values());

  const cards: CardSynergy[] = [...dir.entries()]
    .map(([name, v]) => {
      const authority = authorityByName.get(name) ?? 0;
      const feederLift = Math.sqrt(v.feederSum);
      // THE BLEND IS STATED, NOT EMERGENT (spec 2026-08-18-per-role-score §3.1). A card carries one
      // score summed across BOTH roles, so a discount on its glutted-FEEDER role drags its rating
      // in a scarce-PAYOFF role nothing discounted -- the measured reason the magnitude term ships
      // off. `roleBlend: 1` is the historical behaviour exactly; absent reads as 1.
      const score = authority + ROLE_BLEND * feederLift;
      const tags = tagsByName.get(name);
      const raw = tags ? computeCardBuckets(tags, impactWeights) : { consistency: 0, efficiency: 0, "win-condition": 0 };
      const authorityNorm = maxAuthority > 0 ? authority / maxAuthority : 0;
      const winCondition = raw["win-condition"] + (comboCardNames.has(name) ? COMBO_BONUS : 0) + WIN_CON_AUTHORITY_WEIGHT * authorityNorm;
      const bucketCount =
        (score > 0 ? 1 : 0) + (raw.consistency > 0 ? 1 : 0) + (raw.efficiency > 0 ? 1 : 0) + (winCondition > 0 ? 1 : 0);
      const versatilityMult = 1 + VERSATILITY_STEP * Math.max(0, bucketCount - 1);
      // Dedupe partners by name (a mutual pair — each feeds AND is fed by the other — otherwise
      // appears twice, once per direction), keeping the max-contribution entry. Display-only: score
      // and authority above are computed from v.support/v.feederSum directly, unaffected by this.
      const dedupedPartners = new Map<string, { name: string; contribution: number; reasons: Reason[] }>();
      for (const partner of v.partners) {
        const existing = dedupedPartners.get(partner.name);
        if (!existing || partner.contribution > existing.contribution) dedupedPartners.set(partner.name, partner);
      }
      const distinctPartners = [...dedupedPartners.values()];
      const base = {
        name,
        isCommander: commanderSet.has(name),
        score,
        authority,
        feederLift,
        partnerCount: distinctPartners.length,
        topPartners: distinctPartners
          .sort((x, y) => y.contribution - x.contribution)
          .slice(0, 5)
          .map(({ name, reasons }) => ({ name, score: claimCount(reasons), reasons })),
      };
      return bucketCount > 0
        ? { ...base, bucketScores: { consistency: raw.consistency * versatilityMult, efficiency: raw.efficiency * versatilityMult, "win-condition": winCondition * versatilityMult }, bucketCount }
        : base;
    })
    .sort((x, y) => y.score - x.score || y.partnerCount - x.partnerCount || x.name.localeCompare(y.name));

  const nonlandByName = new Map(resolved.map((dc) => [dc.card.name, !isLand(dc)] as const));
  const { ratingByName, payoffRatingByName, feederRatingByName, positiveCoherence } = computeSynergyRatings(
    cards.map((c) => ({
      name: c.name,
      score: c.score,
      payoffScore: c.authority ?? 0,
      feederScore: c.feederLift ?? 0,
      isNonland: nonlandByName.get(c.name) ?? true,
      axisWeight: bestAxisWeight.get(c.name) ?? 0,
    })),
  );

  // Deck-level Anchoring facet (how strongly the deck's best-fed anchor is supported) and a
  // composite SYNERGY blending Breadth (positiveCoherence) with Anchoring.
  // tunable: absolute authority at which Anchoring saturates to 5. Calibrated on 11 real decks —
  // top-anchor authority ran ~6 (combo/tribal) to ~11 (heavily-fed engines), so 10 spreads them
  // ~3-5 instead of saturating everything. Basis is the single best anchor (max authority); if that
  // proves noisy on other decks, a mean-of-top-K basis is the upgrade.
  const ANCHOR_TARGET = 10;
  const SYNERGY_BREADTH_WEIGHT = 1; // tunable blend weights
  const SYNERGY_ANCHOR_WEIGHT = 1;
  const round1 = (x: number): number => Math.round(x * 10) / 10;
  const topAuthority = Math.max(0, ...authorityByName.values());
  const anchoring = round1(5 * Math.min(topAuthority / ANCHOR_TARGET, 1));
  const breadth = positiveCoherence ?? 0;
  const synergyOverall = round1(
    (SYNERGY_BREADTH_WEIGHT * breadth + SYNERGY_ANCHOR_WEIGHT * anchoring) / (SYNERGY_BREADTH_WEIGHT + SYNERGY_ANCHOR_WEIGHT),
  );
  // Double-duty: a card that fills a functional BUILD role AND sits on the deck's synergy axis is
  // efficient — one card, two jobs — so it gets a small capped rating premium and a marker.
  // ponytail: detectBuildCategories also runs inside computeBuild below; the second linear scan is
  // negligible and keeps computeBuild's signature untouched.
  const buildRoles = rolesByCard(detectBuildCategories(resolved));
  const ratedCards: CardSynergy[] = cards.map((c) => {
    const roles = buildRoles.get(c.name);
    const base = ratingByName.get(c.name) ?? 0;
    const doubleDuty = !!roles && roles.length > 0 && onAxisCards.has(c.name);
    const axisWeight = bestAxisWeight.get(c.name) ?? 0;
    // The role ratings are NOT given the doubleDuty premium: that premium is a statement about the
    // card filling two BUILD jobs, not about either synergy role, so it stays on the headline and
    // the additive identity breaks for those cards by design.
    const payoffRating = payoffRatingByName.get(c.name) ?? 0;
    const feederRating = feederRatingByName.get(c.name) ?? 0;
    return doubleDuty
      ? { ...c, synergyRating: doubleDutyRating(base), payoffRating, feederRating, axisWeight, doubleDuty: true, doubleDutyRoles: roles, roles }
      : { ...c, synergyRating: base, payoffRating, feederRating, axisWeight, roles };
  });

  // themes and cohesion must agree on which tag leads, so both come from this one
  // rankThemes(deckFreq, ...) call instead of themes using its own raw-count sort.
  // The SAME stats the axis is built from (line 113). This passed `UNIFORM_STATS` -- the empty-corpus
  // fallback, where `globalIDF` is `log 2` for every tag -- so theme ranking collapsed to raw deck
  // frequency and the commonest mechanism won in every deck. Measured on the 71 calibration decks
  // before the fix: seven of eight spellslinger/aristocrat decks themed as "draw", and
  // orzhov-spellslinger led with "lose life". A deck's theme is what is DISTINCTIVE about it, which
  // is exactly what idf measures and what a constant idf cannot say.
  // A DECK IS WHAT ITS PAYOFFS CARE ABOUT, NOT WHAT ITS CARDS HAPPEN TO DO. `deckFreq` counts
  // triggers, emits and static effects alike, so a mechanic the deck merely DOES outvoted the one it
  // is built around: the owner's Sorin list has 20 cards emitting life loss — removal spells that
  // drain incidentally — against 7 triggering on casting a noncreature spell, and themed "lose life"
  // while Charitable Levy, Sedgemoor Witch and Primal Amulet were the engine.
  //
  // A card that CARES about a tag counts full; one that only supplies it counts PRODUCER_SHARE.
  // Not consumer-ONLY, which was measured and rejected: it fixes orzhov-spellslinger but strips
  // wick-changelings of its rats and marchesa of its subjects, because a token or legends deck's
  // identity really is in what it produces.
  //
  // Ranking only. `computeCohesion` keeps the RAW deckFreq below, so the reported cohesion score
  // stays "how many cards carry this theme" rather than a weighted quantity nobody can read.
  const PRODUCER_SHARE = 0.35; // tunable; calibrated across the 71 decks (see the commit message).
  const caresFreq = new Map<string, number>();
  for (const dc of resolved) {
    if (!dc.tags) continue;
    for (const tag of cardCaresTags(dc.tags)) caresFreq.set(tag, (caresFreq.get(tag) ?? 0) + 1);
  }
  const rankFreq = new Map<string, number>();
  for (const [tag, n] of deckFreq) {
    const cares = caresFreq.get(tag) ?? 0;
    rankFreq.set(tag, cares + PRODUCER_SHARE * (n - cares));
  }
  // Family-grouped ranking, gated on `themeRank` in impact-weights.json. `alpha: 0` (the shipped
  // default) is the per-tag ranking exactly. See specs/2026-08-19-theme-family-ranking-design.md.
  // Hoisted above the theme ranking: loop ranking reads the reasons to split surplus from payoffs.
  const allReasons = [...cardEdges.flatMap((e) => e.reasons), ...twoHopCensusReasons];
  const themeRank = impactWeights.themeRank;
  const tfidfRanked = rankThemes(rankFreq, themeStats, themeRank && themeRank.alpha > 0
    ? { fold: makeFold(hierarchy), alpha: themeRank.alpha, massShare: themeRank.massShare }
    : undefined);
  // LOOP RANKING reads the membership split (surplus / baseline / payoffs) that `themeMembership`
  // has always computed and nothing ranked by. Built here rather than at the report assembly below
  // because the ranking now depends on it. See theme-loop.ts.
  const loopMembership = themeRank?.mode === "loop"
    ? themeMembership(resolved, allReasons, themeCandidates([...deckFreq.keys()]))
    : undefined;
  const rankedThemes = loopMembership
    ? (() => {
        const tfidf = new Map(tfidfRanked.map((t, i) => [t, tfidfRanked.length - i]));
        const byLoop = rankThemesByLoop(loopMembership, tfidf);
        // A deck where no tag closes a loop keeps the old ranking rather than reporting nothing.
        return byLoop.length > 0 ? byLoop : tfidfRanked;
      })()
    : tfidfRanked;
  // THE PROMOTION RULE (spec §10). A post-rank guard only the HEAD can move through: a headline must
  // not be a strict generalization of a sibling the deck plainly cares about. Needs the census, so
  // it is computed here whether or not loop mode asked for one. See theme-promote.ts.
  const promoteMembership = loopMembership
    ?? themeMembership(resolved, allReasons, themeCandidates([...deckFreq.keys()]));
  const promotedThemes = promoteSpecificHeadline(rankedThemes, deckFreq, promoteMembership);
  const themes = promotedThemes.map((tag) => ({ tag, count: deckFreq.get(tag) ?? 0 }));

  const nonlandCount = resolved.filter((dc) => !isLand(dc)).length;
  const cohesion = computeCohesion(promotedThemes, deckFreq, nonlandCount, makeFold(hierarchy));

  const deckStats = computeDeckStats(resolved.map((dc) => dc.card));

  const archetypes = groupEdgesByArchetype(cardEdges);

  const cardSignals = resolved
    .filter((dc) => dc.tags && !isLand(dc))
    .map((dc) => ({
      name: dc.card.name,
      themeTags: [...cardThemeTags(dc.tags!)],
      effectKinds: dc.tags!.abilities.map((a) => a.effect.kind),
      subtypes: (dc.tags!.characteristics?.subtypes ?? []).filter(
        (s) => s === "equipment" || (s === "aura" && /enchant creature/i.test(dc.card.oracleText)),
      ),
    }));
  const comboCards = [...new Set(foundCombos.flatMap((c) => c.cards))];
  const strategies = detectArchetypes(cardSignals, comboCards, nonlandCount);
  const { buildScore, buildCategories, suggestions } = computeBuild(resolved, strategies[0]?.name);

  // THE CUT LIST -- a join over what is already computed, never new analysis. It reads the rated
  // cards, the axis weights, the BUILD roles and the per-category surplus, and names CANDIDATES
  // with their reasons; see `cut-list.ts` for the three failure directions that make "candidates,
  // with the argument attached" the only honest shape for it.
  const deckRoleCards = new Set(
    resolved
      .filter((dc) => dc.tags?.abilities?.some((a) => ROLE_NOT_SYNERGY.has(a.effect.kind)))
      .map((dc) => dc.card.name),
  );
  const cutList = cutCandidates(
    ratedCards.map((c) => ({
      name: c.name,
      rating: c.synergyRating ?? 0,
      axisWeight: c.axisWeight ?? 0,
      partnerCount: c.partnerCount,
      roles: c.roles ?? [],
      isLand: !(nonlandByName.get(c.name) ?? true),
      isCommander: c.isCommander,
      isComboPiece: comboCardNames.has(c.name),
      fillsDeckRole: deckRoleCards.has(c.name),
    })),
  );
  const slack = deckSlack(buildCategories);

  // Theme membership: same axis ordering the zones will read, with statics dropped (an anthem is a
  // payoff of the theme supplying its subject, never a theme itself).
  const candidateTags = themeCandidates([...axis.keys()]);
  const membership = themeMembership(resolved, allReasons, candidateTags).map((t) => ({
    tag: t.tag,
    surplus: t.surplus.length,
    payoffs: t.payoffs.length,
    baseline: t.baseline.length,
    selective: t.selective,
  }));

  return {
    commanders: presentCommanders,
    cards: ratedCards,
    edges,
    /** How many copies each repeated card contributes, so one node can say "x6". Absent for
     *  singletons, which is every card in a legal EDH deck except basics and the any-number family
     *  (Dragon's Approach, Rat Colony, Shadowborn Apostle). */
    quantities,
    /** Every token node the deck built (Task 6), each flagged with whether an edge beyond its own
     *  maker touches it. Empty when `tokenTags` was never supplied -- most of the ~15 existing
     *  callers, none of which need the graph view. */
    tokenNodes: tokenNodesReport,
    combos: foundCombos,
    themes,
    manaCurve: deckStats.manaCurve,
    landCount: deckStats.landCount,
    avgManaValue: deckStats.avgManaValue,
    medianManaValue: deckStats.medianManaValue,
    positiveCoherence,
    anchoring,
    synergyOverall,
    axis: [...axis].map(([tag, weight]) => ({ tag, weight })).sort((x, y) => y.weight - x.weight || x.tag.localeCompare(y.tag)),
    roles: computeRoles(resolved),
    cohesion,
    archetypes,
    strategies,
    buildScore,
    buildCategories,
    suggestions,
    cutList,
    slack,
    // No turn override: the deck's own clock sets the horizon. Passing a 5 here is what kept the
    // whole clock-pricing change from reaching the report at all -- every unit test passed because
    // they call computeDeckMath directly, and only a live deck showed `turnSource: "override"`.
    deckMath: computeDeckMath(resolved, hierarchy, [...commanderSet], undefined, { comboCards }),
    themeMembership: membership,
  };
}
