export * from "./types.js";
export { analyzeDeckStructured } from "./analyze.js";
export { subjectMatches } from "./subject.js";
export { pairReasons, cardThemeTags, themeSubjectKey, directedReasons } from "./edges.js";
export { loadHierarchy, buildHierarchy, impliesType } from "./hierarchy.js";
export { resolveChosenTypes, deckSubtypeCounts } from "./chosen-type.js";
export { buildDeckCards, type CardTagsLookup } from "./deck-cards.js";
export { parseStat, evalStatPredicate } from "./stats.js";
export { buildGraph, type CardGraph, type GraphNode, type GraphEdge, type NodeKind, type EdgeKind } from "./graph.js";
export { addEventEdges, orphanCards } from "./graph-events.js";
export { themeMembership, themeCandidates, BASELINE_CAP, type ThemeMembership } from "./themes.js";
export { classifyEffect, type EffectClass } from "./effect-class.js";
export {
  deckAvailability, type AvailabilityRow, type AvailabilityOptions,
} from "./availability.js";
export {
  detectAnswerClasses, detectBuildCategories, BUILD_CATEGORIES, type BuildCategory,
} from "./build.js";
export {
  manaAudit, pipsByColor, COLORS, SOURCE_CONFIDENCE,
  type Color, type ColorDemand, type ManaAuditRow,
} from "./mana-audit.js";
export { landInputs, recommendedLands, type LandRecommendation } from "./land-count.js";
export {
  answerClassesOf, loadRules, ruleMatches, RULES_VERSION,
  type Rule, type RuleClause, type RuleSet,
} from "./rules.js";
export { meshReport, MESH_CAP, type MeshReport, type MeshGroup } from "./mesh.js";
export {
  buildTagIndex, candidateFromTagIndex, mergeFixtures, pairKey, pickStratum, randomPair, upsertPair,
  type ClauseFixture, type PairRecord, type Stratum, type TagDefect, type Verdict,
} from "./bin/pair-calibrate-core.js";
