import {
  COMMANDER_BOOST,
  rankThemes,
  computeCohesion,
  loadImpactWeights,
  impactEdgeWeight,
  dampByAlpha,
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
 * `combos` is always `[]` (Stage 2 has no structured combo index) and theme ranking uses a
 * uniform TagStats (deck-frequency-only; no global IDF corpus yet).
 */
export function analyzeDeckStructured(
  inputs: DeckCard[],
  commanderNames?: string[],
  hierarchy: Hierarchy = loadHierarchy(),
  impactWeights: ImpactWeights = loadImpactWeights(),
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

  // Aggregate per card (mirrors the flat engine's analyzeDeck).
  const agg = new Map<string, Agg>();
  for (const dc of resolved) {
    agg.set(dc.card.name, { name: dc.card.name, weighted: 0, partnerCount: 0, partners: [] });
  }
  for (const edge of edges) {
    const w = impactEdgeWeight(edge.reasons, impactWeights);
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

  const cards: CardSynergy[] = [...agg.values()]
    .map((v) => ({
      name: v.name,
      isCommander: commanderSet.has(v.name),
      score: dampByAlpha(v.weighted, v.partnerCount, impactWeights.damping),
      partnerCount: v.partnerCount,
      topPartners: v.partners
        .sort((x, y) => y.contribution - x.contribution)
        .slice(0, 5)
        .map(({ name, score, reasons }) => ({ name, score, reasons })),
    }))
    .sort((x, y) => y.score - x.score || y.partnerCount - x.partnerCount || x.name.localeCompare(y.name));

  const themes = [...deckFreq.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((x, y) => y.count - x.count || x.tag.localeCompare(y.tag));

  const nonlandCount = resolved.filter((dc) => !dc.card.typeLine.toLowerCase().includes("land")).length;
  const cohesion = computeCohesion(rankThemes(deckFreq, UNIFORM_STATS), deckFreq, nonlandCount);
  const presentCommanders = resolved.map((dc) => dc.card.name).filter((n) => commanderSet.has(n));

  return {
    commanders: presentCommanders,
    cards,
    edges,
    combos: [],
    themes,
    roles: { ramp: 0, draw: 0, removal: 0 },
    cohesion,
  };
}
