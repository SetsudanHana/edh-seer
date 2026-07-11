import type { Card } from "./card.js";
import { synergyScore, type Reason } from "./synergy.js";
import { extractTags, type Tag } from "./tags.js";
import type { Combo, ComboIndex } from "./combos.js";

export interface SynergyEdge {
  a: string;
  b: string;
  score: number;
  reasons: Reason[];
}

export interface DeckReport {
  edges: SynergyEdge[];
  combos: Combo[];
  themes: { tag: string; count: number }[];
  roles: { ramp: number; draw: number; removal: number };
}

export function analyzeDeck(cards: Card[], combos?: ComboIndex): DeckReport {
  const edges: SynergyEdge[] = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const r = synergyScore(cards[i], cards[j], combos);
      if (r.score > 0) {
        edges.push({ a: cards[i].name, b: cards[j].name, score: r.score, reasons: r.reasons });
      }
    }
  }
  edges.sort((x, y) => y.score - x.score);

  const names = new Set(cards.map((c) => c.name));
  const foundCombos = combos?.combosContainedIn(names) ?? [];

  const themeCounts = new Map<Tag, number>();
  const roles = { ramp: 0, draw: 0, removal: 0 };
  for (const card of cards) {
    const { produces } = extractTags(card);
    for (const tag of produces) {
      themeCounts.set(tag, (themeCounts.get(tag) ?? 0) + 1);
    }
    if (produces.has("ramp")) roles.ramp++;
    if (produces.has("card-draw")) roles.draw++;
    if (produces.has("removal")) roles.removal++;
  }
  const themes = [...themeCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((x, y) => y.count - x.count);

  return { edges, combos: foundCombos, themes, roles };
}
