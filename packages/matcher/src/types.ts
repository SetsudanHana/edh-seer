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
  /** WHICH PRINTED FACE this node is, 0 for the front. Absent on a single-face card and on a token,
   *  so `dc.face !== undefined` is "this is one face of a multi-face card". A FACE IS A NODE
   *  (2026-08-27): two faces watch different events and supply different ones, so they are two
   *  entries in the pair pool and two nodes on the board. Face nodes ride in `unique` and must stay
   *  OUT of `resolved` — every figure built from that list is a statement about a 100-card library,
   *  and a face is not an extra card. */
  face?: number;
  /** The PHYSICAL card's full name ("A // B") when this node is one face of it. `card.name` holds
   *  the FACE's name so the by-name maps in `analyze.ts` stay collision-free; `stampSides` rewrites
   *  a reason's `producer`/`consumer` back to this, because `pairs.json` keys the whole judged panel
   *  on `producer|consumer|tag`. */
  parentName?: string;
}

/** Lowercased subtype -> lowercased supertypes it belongs to, e.g. { wizard: ["creature"] }. */
export type Hierarchy = Record<string, string[]>;
