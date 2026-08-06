export * from "./schema.js";
export {
  OTAG_EVENTS,
  OTAG_EVENT_TO_VERB,
  loadOtagSemantics,
  unclassifiedSlugs,
  type OtagEvent,
  type OtagRole,
  type OtagUse,
  type SlugSemantics,
} from "./otags/semantics.js";
export { loadFunctionalOtags, loadDescriptorOtags } from "./otags/functional.js";
export { deriveAbilities, deriveCardTags, type DeriveInput } from "./derive/derive.js";
export { CARD_TYPES, UMBRELLA_TYPES } from "./derive/subject.js";
export { canonicalize, canonicalClause, type Action, type ClauseRecord } from "./canonicalize.js";
export { segment, type Clause } from "./segment.js";
export {
  validateClauses, rejections,
  type ClauseViolation, type ViolationKind,
} from "./validate-clauses.js";
export {
  segmentHash, needsNormalize, needsDerive, carriesOther, disagreesOnType, ensureClauseIndexes,
  CLAUSES_COLLECTION, DERIVED_COLLECTION,
  type CardClausesDoc, type DerivedTagsDoc,
} from "./clause-store.js";
export {
  createTagsLookup, composeTagsLookup, resolveTagsSource,
  type TagsSource, type TagsReader,
} from "./tags-lookup.js";

export { SUBTYPES, LAND_SUBTYPES } from "./derive/subtypes.js";
