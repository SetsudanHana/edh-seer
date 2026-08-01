import {
  COMMANDER_BOOST,
  rankThemes,
  computeCohesion,
  loadImpactWeights,
  impactEdgeWeight,
  dampByAlpha,
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
import { pairReasons, cardThemeTags } from "./edges.js";
import { deckSubtypeCounts, resolveChosenTypes } from "./chosen-type.js";
import { computeCardBuckets } from "./buckets.js";
import { groupEdgesByArchetype } from "./mechanisms.js";
import { buildAxis, axisFactor } from "./axis.js";
import { detectArchetypes } from "./archetypes.js";
import { computeBuild } from "./build.js";

/** Uniform IDF: every theme has equal corpus weight, so rankThemes/themeWeights degrade to a
 *  pure deck-frequency ranking. Stage 3 replaces this with a real structured-corpus TagStats. */
const UNIFORM_STATS: TagStats = { N: 1, counts: {} };

interface Agg {
  name: string;
  weighted: number;
  partnerCount: number;
  partners: { name: string; score: number; reasons: Reason[]; contribution: number }[];
}

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
  const axis = buildAxis(commanderThemeTags, deckFreq);
  const AXIS_BOOST = 1.5; // tunable: a fully on-axis edge counts 2.5x an off-axis one.

  // Aggregate per card (mirrors the flat engine's analyzeDeck).
  const agg = new Map<string, Agg>();
  for (const dc of resolved) {
    agg.set(dc.card.name, { name: dc.card.name, weighted: 0, partnerCount: 0, partners: [] });
  }
  const onAxisCards = new Set<string>();
  for (const edge of edges) {
    const af = axisFactor(edge.reasons, axis, AXIS_BOOST);
    const w = impactEdgeWeight(edge.reasons, impactWeights) * af;
    if (af > 1) {
      onAxisCards.add(edge.a);
      onAxisCards.add(edge.b);
    }
    const boostForA = commanderSet.has(edge.b) ? COMMANDER_BOOST : 1;
    const boostForB = commanderSet.has(edge.a) ? COMMANDER_BOOST : 1;
    const a = agg.get(edge.a);
    const b = agg.get(edge.b);
    if (a) {
      a.weighted += w * boostForA;
      a.partnerCount += 1;
      a.partners.push({ name: edge.b, score: edge.score, reasons: edge.reasons, contribution: w * boostForA });
    }
    if (b) {
      b.weighted += w * boostForB;
      b.partnerCount += 1;
      b.partners.push({ name: edge.a, score: edge.score, reasons: edge.reasons, contribution: w * boostForB });
    }
  }

  const presentCommanders = resolved.map((dc) => dc.card.name).filter((n) => commanderSet.has(n));
  const deckNames = new Set(resolved.map((dc) => dc.card.name));
  const foundCombos: Combo[] = combos?.combosContainedIn(deckNames) ?? [];
  const comboCardNames = new Set(foundCombos.flatMap((c) => c.cards));
  const tagsByName = new Map(resolved.map((dc) => [dc.card.name, dc.tags] as const));

  const VERSATILITY_STEP = 0.15;
  const COMBO_BONUS = 1.5;

  const cards: CardSynergy[] = [...agg.values()]
    .map((v) => {
      const score = dampByAlpha(v.weighted, v.partnerCount, impactWeights.damping);
      const tags = tagsByName.get(v.name);
      const raw = tags
        ? computeCardBuckets(tags, impactWeights)
        : { consistency: 0, efficiency: 0, "win-condition": 0 };
      const winCondition = raw["win-condition"] + (comboCardNames.has(v.name) ? COMBO_BONUS : 0);
      const bucketCount =
        (score > 0 ? 1 : 0) +
        (raw.consistency > 0 ? 1 : 0) +
        (raw.efficiency > 0 ? 1 : 0) +
        (winCondition > 0 ? 1 : 0);
      const versatilityMult = 1 + VERSATILITY_STEP * Math.max(0, bucketCount - 1);
      const base = {
        name: v.name,
        isCommander: commanderSet.has(v.name),
        score,
        partnerCount: v.partnerCount,
        topPartners: v.partners
          .sort((x, y) => y.contribution - x.contribution)
          .slice(0, 5)
          .map(({ name, score, reasons }) => ({ name, score, reasons })),
      };
      return bucketCount > 0
        ? {
            ...base,
            bucketScores: {
              consistency: raw.consistency * versatilityMult,
              efficiency: raw.efficiency * versatilityMult,
              "win-condition": winCondition * versatilityMult,
            },
            bucketCount,
          }
        : base;
    })
    .sort((x, y) => y.score - x.score || y.partnerCount - x.partnerCount || x.name.localeCompare(y.name));

  const nonlandByName = new Map(resolved.map((dc) => [dc.card.name, !isLand(dc)] as const));
  const { ratingByName, positiveCoherence } = computeSynergyRatings(
    cards.map((c) => ({
      name: c.name,
      score: c.score,
      isNonland: nonlandByName.get(c.name) ?? true,
      onAxis: onAxisCards.has(c.name),
    })),
  );
  const ratedCards: CardSynergy[] = cards.map((c) => ({ ...c, synergyRating: ratingByName.get(c.name) ?? 0 }));

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
