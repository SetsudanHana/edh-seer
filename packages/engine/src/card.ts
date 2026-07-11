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
}
