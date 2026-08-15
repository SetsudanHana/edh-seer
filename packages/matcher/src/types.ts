import type { Card } from "@mtg/engine";
import type { CardTags } from "@mtg/tagger";

/** A deck card paired with its structured tags (null when the card was never tagged). */
export interface DeckCard {
  card: Card;
  tags: CardTags | null;
  /** True for a synthetic token node (Task 6, tokens-as-nodes) -- a Treasure, a Clue, a Wizard Kuja
   *  makes. Absent (not merely false) for every real deck card, so `dc.isToken` is a safe truthy
   *  check either way. Tokens are built by `analyzeDeckStructured`, never by `buildDeckCards`, and
   *  must stay OUT of `computeDeckMath`/`deckFreq`/`computeRoles`/`detectBuildCategories`/
   *  `ratedCards` -- every figure those produce is a probability over a 100-card library, and a
   *  token is never drawn. */
  isToken?: boolean;
}

/** Lowercased subtype -> lowercased supertypes it belongs to, e.g. { wizard: ["creature"] }. */
export type Hierarchy = Record<string, string[]>;
