import type { Card } from "@mtg/engine";
import type { CardTags } from "@mtg/tagger";

/** A deck card paired with its structured tags (null when the card was never tagged). */
export interface DeckCard {
  card: Card;
  tags: CardTags | null;
}

/** Lowercased subtype -> lowercased supertypes it belongs to, e.g. { wizard: ["creature"] }. */
export type Hierarchy = Record<string, string[]>;
