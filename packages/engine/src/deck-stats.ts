import type { Card } from "./card.js";

export interface ManaCurveBucket {
  /** 0-6 exact mana value, or 7 meaning "7 or more". */
  value: number;
  count: number;
}

export interface DeckStats {
  manaCurve: ManaCurveBucket[];
  landCount: number;
  avgManaValue: number;
  medianManaValue: number;
}

function isLand(card: Card): boolean {
  return card.typeLine.toLowerCase().includes("land");
}

/** Nonland-only mana curve/avg/median (the conventional MTG-curve scope); land count
 *  is over the full card list. Shared by both `analyzeDeck` and `analyzeDeckStructured`
 *  so the two report shapes never drift on this computation. */
export function computeDeckStats(cards: Card[]): DeckStats {
  const nonland = cards.filter((c) => !isLand(c));
  const landCount = cards.length - nonland.length;

  const manaCurve: ManaCurveBucket[] = Array.from({ length: 8 }, (_, value) => ({ value, count: 0 }));
  for (const c of nonland) {
    const bucket = Math.min(Math.floor(c.manaValue), 7);
    manaCurve[bucket].count += 1;
  }

  const values = nonland.map((c) => c.manaValue).sort((a, b) => a - b);
  const avgManaValue = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
  let medianManaValue = 0;
  if (values.length > 0) {
    const mid = Math.floor(values.length / 2);
    medianManaValue = values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
  }

  return { manaCurve, landCount, avgManaValue, medianManaValue };
}
