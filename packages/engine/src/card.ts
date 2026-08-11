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
