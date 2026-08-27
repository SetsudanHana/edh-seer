/** One printed face of a card. STRUCTURALLY DUPLICATED from `@mtg/data`'s `CardFace` rather than
 *  imported, for the same reason `allParts` is read off an untyped cast: the engine cannot depend on
 *  the data package. A plain data shape is cheap to restate and a dependency edge is not. */
export interface CardFace {
  name: string;
  typeLine: string;
  oracleText: string;
  manaCost?: string;
  power?: string;
  toughness?: string;
  colors: string[];
  /** Present on faces with no mana cost, where colour cannot be read off the cost. */
  colorIndicator?: string[];
  artCrop?: string;
}

export interface Card {
  /** Card name, e.g. "Krenko, Mob Boss". */
  name: string;
  /** Scryfall type_line, e.g. "Legendary Creature — Goblin Warrior". Multi-face cards join their
   *  faces with " // ". */
  typeLine: string;
  /** Scryfall layout: "normal", "transform", "modal_dfc", "split", "adventure", "flip", … It is
   *  what separates a two-faced card you may cast from either side from one whose back face is only
   *  reached by transforming a permanent already in play — the type line alone cannot say. */
  layout?: string;
  /** The card's PRINTED faces, in printed order — every layout, including `transform`, whose back
   *  face is never cast. A FACE IS A NODE: this is what says how many nodes a card draws, and it is
   *  a different question from what each face SUPPLIES, which `Characteristics.faces` answers (that
   *  one lists only the PLAYABLE faces, so a transform back is absent from it by design).
   *  Absent on a single-face card. */
  faces?: CardFace[];
  /** Scryfall oracle_text; empty string when the card has none. */
  oracleText: string;
  /** Scryfall keywords, e.g. ["Flying"]. */
  keywords: string[];
  /** Color abbreviations, e.g. ["R","G"]. */
  colors: string[];
  /** Scryfall cmc / mana value. */
  manaValue: number;
  /** Scryfall mana_cost, e.g. "{2}{B}{B}". The PIPS are what the mana audit reads -- `manaValue`
   *  says a card costs 4 and cannot say that two of those are black. Absent on lands and on the
   *  back faces of split cards. */
  manaCost?: string;
  /** WotC's Commander Bracket "Game Changer" list — 53 cards, straight from Scryfall's
   *  `game_changer`. A published LIST rather than a judgement, which is what makes the bracket rule
   *  a lookup. Present only when the source card carried it.
   *
   *  THE THIRD FIELD FOUND SITTING ON `CardDoc` AND DROPPED BY `docToCard`, after `producedMana`
   *  and `allParts`. Check that join before recording a field as "stored, unused". */
  gameChanger?: boolean;
  /** Scryfall produced_mana: the colours this card can add, e.g. ["B","G"]. Includes "C" for
   *  colorless. Present only on cards that produce mana at all.
   *
   *  It is a claim about what the card CAN produce, not about what it produces reliably: a land
   *  that enters tapped and a Sol Ring both count, and "add one mana of any color" lists all five.
   *  Anything reading it owes the reader that caveat. */
  producedMana?: string[];
  /** Scryfall color_identity, e.g. ["B","R","U"]. */
  colorIdentity?: string[];
  /** Scryfall power; null for non-creatures. May be "*". */
  power?: string | null;
  /** Scryfall toughness; null for non-creatures. May be "*". */
  toughness?: string | null;
  /** The card this one MELDS with, by name.
   *
   *  A printed characteristic, not an inferred one — it comes from Scryfall's `all_parts`. It lives
   *  here because meld is a card-NAME relation and the engine otherwise matches producer events to
   *  consumer triggers, so there was no shape for "a creature named Phyrexian Dragon Engine". */
  meldPartner?: string;
}
