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
import { pairReasons, cardThemeTags, cardCaresTags, directedReasons, createsReasons } from "./edges.js";
import { createdTokenRefs, type TokenRef } from "./tokens.js";
import { markCommander } from "./commander.js";
import { deckSubtypeCounts, resolveChosenTypes } from "./chosen-type.js";
import { computeCardBuckets } from "./buckets.js";
import { groupEdgesByArchetype } from "./mechanisms.js";
import { buildAxis, maxAxisWeight } from "./axis.js";
import { detectArchetypes } from "./archetypes.js";
import { computeBuild, detectBuildCategories, rolesByCard, doubleDutyRating } from "./build.js";
import { computeDeckMath } from "./deck-math.js";
import { loadThemeStats } from "./theme-stats.js";
import { themeMembership, themeCandidates } from "./themes.js";

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
  const tokenNodes: DeckCard[] = [];
  const producerTokenOracles = new Map<string, Set<string>>();
  if (tokenTags) {
    const byOracle = new Map<string, DeckCard>();
    for (const dc of unique) {
      for (const ref of createdTokenRefs(dc.card)) {
        const tags = tokenTags(ref);
        if (!tags) continue; // unresolved -- refuse, never fall back to a (name, typeLine) lookup
        let node = byOracle.get(tags.oracleId);
        if (!node) {
          node = tokenDeckCard(ref, tags);
          byOracle.set(tags.oracleId, node);
          tokenNodes.push(node);
        }
        let oracles = producerTokenOracles.get(dc.card.name);
        if (!oracles) producerTokenOracles.set(dc.card.name, (oracles = new Set()));
        oracles.add(tags.oracleId);
      }
    }
  }

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
        const edge = { a: a.card.name, b: b.card.name, score: reasons.length, reasons };
        edges.push(edge);
        if (!a.isToken && !b.isToken) cardEdges.push(edge);
      }
    }
  }
  edges.sort((x, y) => y.score - x.score);

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
  for (let i = 0; i < unique.length; i++) {
    for (let j = 0; j < unique.length; j++) {
      if (i === j) continue;
      const p = unique[i], c = unique[j];
      const reasons = directedReasons(p, c, hierarchy); // p feeds c
      if (reasons.length === 0) continue;
      const maxW = maxAxisWeight(reasons, axis);
      const w = impactEdgeWeight(reasons, impactWeights) * (1 + AXIS_BOOST * maxW);
      // Commander boost: credit is amplified when the OTHER endpoint is the commander (mirrors the
      // old boostForA/boostForB semantics).
      const payoffBoost = commanderSet.has(p.card.name) ? COMMANDER_BOOST : 1;
      const feederBoost = commanderSet.has(c.card.name) ? COMMANDER_BOOST : 1;
      const cAgg = dir.get(c.card.name)!;
      const pAgg = dir.get(p.card.name)!;
      cAgg.support += w * payoffBoost;
      cAgg.partnerCount += 1;
      cAgg.partners.push({ name: p.card.name, contribution: w * payoffBoost, reasons });
      pAgg.feederSum += FEEDER_SHARE * w * feederBoost;
      pAgg.partnerCount += 1;
      pAgg.partners.push({ name: c.card.name, contribution: FEEDER_SHARE * w * feederBoost, reasons });
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
      const score = authority + feederLift;
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
        partnerCount: distinctPartners.length,
        topPartners: distinctPartners
          .sort((x, y) => y.contribution - x.contribution)
          .slice(0, 5)
          .map(({ name, reasons }) => ({ name, score: reasons.length, reasons })),
      };
      return bucketCount > 0
        ? { ...base, bucketScores: { consistency: raw.consistency * versatilityMult, efficiency: raw.efficiency * versatilityMult, "win-condition": winCondition * versatilityMult }, bucketCount }
        : base;
    })
    .sort((x, y) => y.score - x.score || y.partnerCount - x.partnerCount || x.name.localeCompare(y.name));

  const nonlandByName = new Map(resolved.map((dc) => [dc.card.name, !isLand(dc)] as const));
  const { ratingByName, positiveCoherence } = computeSynergyRatings(
    cards.map((c) => ({
      name: c.name,
      score: c.score,
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
    return doubleDuty
      ? { ...c, synergyRating: doubleDutyRating(base), axisWeight, doubleDuty: true, doubleDutyRoles: roles, roles }
      : { ...c, synergyRating: base, axisWeight, roles };
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
  const rankedThemes = rankThemes(rankFreq, themeStats);
  const themes = rankedThemes.map((tag) => ({ tag, count: deckFreq.get(tag)! }));

  const nonlandCount = resolved.filter((dc) => !isLand(dc)).length;
  const cohesion = computeCohesion(rankedThemes, deckFreq, nonlandCount);

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

  // Theme membership: same axis ordering the zones will read, with statics dropped (an anthem is a
  // payoff of the theme supplying its subject, never a theme itself).
  const candidateTags = themeCandidates([...axis.keys()]);
  const allReasons = cardEdges.flatMap((e) => e.reasons);
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
    // No turn override: the deck's own clock sets the horizon. Passing a 5 here is what kept the
    // whole clock-pricing change from reaching the report at all -- every unit test passed because
    // they call computeDeckMath directly, and only a live deck showed `turnSource: "override"`.
    deckMath: computeDeckMath(resolved, hierarchy, [...commanderSet], undefined, { comboCards }),
    themeMembership: membership,
  };
}
