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
import type { DeckCard, Hierarchy } from "./types.js";
import { loadHierarchy } from "./hierarchy.js";
import { pairReasons, cardThemeTags, directedReasons } from "./edges.js";
import { deckSubtypeCounts, resolveChosenTypes } from "./chosen-type.js";
import { computeCardBuckets } from "./buckets.js";
import { groupEdgesByArchetype } from "./mechanisms.js";
import { buildAxis, maxAxisWeight } from "./axis.js";
import { detectArchetypes } from "./archetypes.js";
import { computeBuild, detectBuildCategories, rolesByCard, doubleDutyRating } from "./build.js";
import { loadThemeStats, UNIFORM_STATS } from "./theme-stats.js";

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

export function analyzeDeckStructured(
  inputs: DeckCard[],
  commanderNames?: string[],
  hierarchy: Hierarchy = loadHierarchy(),
  impactWeights: ImpactWeights = loadImpactWeights(),
  combos?: ComboIndex,
  themeStats: TagStats = loadThemeStats(),
): DeckReport {
  const commanderSet = new Set(commanderNames ?? []);

  // Deck-aware chosen-type resolution, applied once before any edge formation.
  const counts = deckSubtypeCounts(inputs);
  const resolved: DeckCard[] = inputs.map((dc) =>
    dc.tags ? { card: dc.card, tags: resolveChosenTypes(dc.tags, counts, hierarchy) } : dc,
  );

  // Pairwise edges over unordered pairs; i < j guarantees no self-pair and no double-count
  // (pairReasons already unions both directions for a given {a,b}).
  const edges: SynergyEdge[] = [];
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const reasons = pairReasons(resolved[i], resolved[j], hierarchy);
      if (reasons.length > 0) {
        edges.push({ a: resolved[i].card.name, b: resolved[j].card.name, score: reasons.length, reasons });
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
  for (const dc of resolved) dir.set(dc.card.name, { support: 0, feederSum: 0, partnerCount: 0, partners: [] });
  for (let i = 0; i < resolved.length; i++) {
    for (let j = 0; j < resolved.length; j++) {
      if (i === j) continue;
      const p = resolved[i], c = resolved[j];
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

  const cards: CardSynergy[] = [...dir.entries()]
    .map(([name, v]) => {
      const authority = authorityByName.get(name) ?? 0;
      const feederLift = Math.sqrt(v.feederSum);
      const score = authority + feederLift;
      const tags = tagsByName.get(name);
      const raw = tags ? computeCardBuckets(tags, impactWeights) : { consistency: 0, efficiency: 0, "win-condition": 0 };
      const winCondition = raw["win-condition"] + (comboCardNames.has(name) ? COMBO_BONUS : 0);
      const bucketCount =
        (score > 0 ? 1 : 0) + (raw.consistency > 0 ? 1 : 0) + (raw.efficiency > 0 ? 1 : 0) + (winCondition > 0 ? 1 : 0);
      const versatilityMult = 1 + VERSATILITY_STEP * Math.max(0, bucketCount - 1);
      const base = {
        name,
        isCommander: commanderSet.has(name),
        score,
        authority,
        partnerCount: v.partnerCount,
        topPartners: v.partners
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
  // Double-duty: a card that fills a functional BUILD role AND sits on the deck's synergy axis is
  // efficient — one card, two jobs — so it gets a small capped rating premium and a marker.
  // ponytail: detectBuildCategories also runs inside computeBuild below; the second linear scan is
  // negligible and keeps computeBuild's signature untouched.
  const buildRoles = rolesByCard(detectBuildCategories(resolved));
  const ratedCards: CardSynergy[] = cards.map((c) => {
    const roles = buildRoles.get(c.name);
    const base = ratingByName.get(c.name) ?? 0;
    const doubleDuty = !!roles && roles.length > 0 && onAxisCards.has(c.name);
    return doubleDuty
      ? { ...c, synergyRating: doubleDutyRating(base), doubleDuty: true, doubleDutyRoles: roles }
      : { ...c, synergyRating: base };
  });

  const themes = [...deckFreq.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((x, y) => y.count - x.count || x.tag.localeCompare(y.tag));

  const nonlandCount = resolved.filter((dc) => !isLand(dc)).length;
  const cohesion = computeCohesion(rankThemes(deckFreq, UNIFORM_STATS), deckFreq, nonlandCount);

  const deckStats = computeDeckStats(resolved.map((dc) => dc.card));

  const archetypes = groupEdgesByArchetype(edges);

  const cardSignals = resolved
    .filter((dc) => dc.tags && !isLand(dc))
    .map((dc) => ({
      name: dc.card.name,
      themeTags: [...cardThemeTags(dc.tags!)],
      effectKinds: dc.tags!.abilities.map((a) => a.effect.kind),
    }));
  const comboCards = [...new Set(foundCombos.flatMap((c) => c.cards))];
  const strategies = detectArchetypes(cardSignals, comboCards, nonlandCount);
  const { buildScore, buildCategories, suggestions } = computeBuild(resolved, strategies[0]?.name);

  return {
    commanders: presentCommanders,
    cards: ratedCards,
    edges,
    combos: foundCombos,
    themes,
    manaCurve: deckStats.manaCurve,
    landCount: deckStats.landCount,
    avgManaValue: deckStats.avgManaValue,
    medianManaValue: deckStats.medianManaValue,
    positiveCoherence,
    roles: computeRoles(resolved),
    cohesion,
    archetypes,
    strategies,
    buildScore,
    buildCategories,
    suggestions,
  };
}
