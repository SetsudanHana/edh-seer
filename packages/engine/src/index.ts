export const ENGINE_VERSION = "0.0.0";
export type { Card, CardFace } from "./card.js";
export type { Tag } from "./tags.js";
export { extractTags, tagFamily, describeTag } from "./tags.js";
export { synergyScore, dedupeReasonsByText, type Reason, type SynergyResult } from "./synergy.js";
export { ComboIndex, type Combo } from "./combos.js";
export {
  analyzeDeck,
  COMMANDER_BOOST,
  type DeckReport,
  type DeckCoverage,
  type DeckMath,
  type SynergyEdge,
  type CardSynergy,
  type ArchetypeGroup,
  type ArchetypeRanking,
} from "./analyze.js";
export { computeDeckStats, type ManaCurveBucket, type DeckStats } from "./deck-stats.js";
export { computeSynergyRatings, type RatedInput, type SynergyRatings } from "./synergy-rating.js";
export {
  type Cohesion,
  type TagStats,
  rankThemes,
  themeWeights,
  globalIDF,
  weightedEdge,
  dampedScore,
  computeCohesion,
} from "./weights.js";
export {
  type ImpactWeights,
  SEED_IMPACT_WEIGHTS,
  UNKNOWN_KIND_WEIGHT,
  loadImpactWeights,
  impactWeightOf,
  impactEdgeWeight,
  dampByAlpha,
} from "./impact.js";
export { suggestCards, type Suggestion } from "./suggest.js";
export { FIXTURES } from "./fixtures.js";
export {
  MECHANICS,
  mechanicCoverageSummary,
  type MechanicEntry,
  type MechanicStatus,
  type MechanicSource,
  type MechanicCoverageSummary,
} from "./mechanics.js";
export {
  comb, jointAvailability, LIBRARY, minCopies, pAtLeast, seen,
} from "./hypergeometric.js";
export { karstenLands, type KarstenInputs } from "./karsten.js";
