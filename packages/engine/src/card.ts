export interface Card {
  /** Card name, e.g. "Krenko, Mob Boss". */
  name: string;
  /** Scryfall type_line, e.g. "Legendary Creature — Goblin Warrior". */
  typeLine: string;
  /** Scryfall oracle_text; empty string when the card has none. */
  oracleText: string;
  /** Scryfall keywords, e.g. ["Flying"]. */
  keywords: string[];
  /** Color abbreviations, e.g. ["R","G"]. */
  colors: string[];
  /** Scryfall cmc / mana value. */
  manaValue: number;
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
