import type { Card } from "./card.js";
import { synergyScore, type Reason } from "./synergy.js";
import type { ComboIndex } from "./combos.js";

export interface Suggestion {
  name: string;
  score: number;
  reasons: Reason[];
}

export function suggestCards(
  deck: Card[],
  pool: Card[],
  combos?: ComboIndex,
  topN = 20,
): Suggestion[] {
  const inDeck = new Set(deck.map((c) => c.name));
  const suggestions: Suggestion[] = [];

  for (const candidate of pool) {
    if (inDeck.has(candidate.name)) continue;
    let score = 0;
    const reasons: Reason[] = [];
    for (const deckCard of deck) {
      const r = synergyScore(candidate, deckCard, combos);
      score += r.score;
      reasons.push(...r.reasons);
    }
    if (score > 0) {
      suggestions.push({ name: candidate.name, score, reasons });
    }
  }

  suggestions.sort((a, b) => b.score - a.score);
  return suggestions.slice(0, topN);
}
