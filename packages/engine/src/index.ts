export const ENGINE_VERSION = "0.0.0";
export type { Card } from "./card.js";
export type { Tag } from "./tags.js";
export { extractTags } from "./tags.js";
export { synergyScore, type Reason, type SynergyResult } from "./synergy.js";
export { ComboIndex, type Combo } from "./combos.js";
export {
  analyzeDeck,
  COMMANDER_BOOST,
  type DeckReport,
  type SynergyEdge,
  type CardSynergy,
} from "./analyze.js";
export { suggestCards, type Suggestion } from "./suggest.js";
export { FIXTURES } from "./fixtures.js";
