export * from "./types.js";
export { analyzeDeckStructured, collectTokenNodes } from "./analyze.js";
export { subjectMatches } from "./subject.js";
export { pairReasons, cardThemeTags, themeSubjectKey, directedReasons, createsReasons, claimCount } from "./edges.js";
export { createdTokenRefs, type TokenRef } from "./tokens.js";
export { loadTokenTags } from "./token-tags.js";
export { loadHierarchy, buildHierarchy, impliesType } from "./hierarchy.js";
export { resolveChosenTypes, deckSubtypeCounts } from "./chosen-type.js";
export { buildDeckCards, type CardTagsLookup } from "./deck-cards.js";
export { parseStat, evalStatPredicate } from "./stats.js";
export { buildGraph, type CardGraph, type GraphNode, type GraphEdge, type NodeKind, type EdgeKind } from "./graph.js";
export { addEventEdges, orphanCards } from "./graph-events.js";
export {
  projectDeckGraph, nodeId, TOKEN_ID_PREFIX,
  type ProjectedGraph,
  type ProjectedNode,
  type ProjectedEdge,
  type ProjectOptions,
} from "./graph-projection.js";
export { themeMembership, themeCandidates, BASELINE_CAP, type ThemeMembership } from "./themes.js";
export { classifyEffect, type EffectClass } from "./effect-class.js";
export {
  deckAvailability, type AvailabilityRow, type AvailabilityOptions,
} from "./availability.js";
export {
  detectAnswerClasses, detectBuildCategories, BUILD_CATEGORIES, type BuildCategory,
  type AnswerClassMembers,
} from "./build.js";
export {
  manaAudit, pipsByColor, COLORS, SOURCE_CONFIDENCE,
  type Color, type ColorDemand, type ManaAuditRow,
} from "./mana-audit.js";
export { landInputs, recommendedLands, type LandRecommendation } from "./land-count.js";
export {
  cardCastability, deckCastability, type CardCastability, type DeckCastability,
} from "./castability.js";
export { detectWincons, focusIndex, winconReport, type WinconReport } from "./wincon.js";
export {
  expectedPower, measuredClock, pressureCurve, STARTING_LIFE, type PressurePoint,
} from "./pressure.js";
export {
  answerClassesOf, loadRules, ruleMatches, RULES_VERSION, type AnswerMarks,
  type Rule, type RuleClause, type RuleSet,
} from "./rules.js";
export { meshReport, MESH_CAP, type MeshReport, type MeshGroup } from "./mesh.js";
export {
  buildTagIndex, candidateFromTagIndex, mergeFixtures, pairKey, pickStratum, randomPair, upsertPair,
  type ClauseFixture, type PairRecord, type Stratum, type TagDefect, type Verdict,
} from "./bin/pair-calibrate-core.js";
export {
  detectLines, classifyGrowth, iterationsNeeded,
  type Line, type Piece, type Resource, type Growth, type DetectLinesResult,
} from "./lines.js";
