import type { Card } from "./card.js";
import { synergyScore, type Reason } from "./synergy.js";
import { extractTags, type Tag } from "./tags.js";
import type { Combo, ComboIndex } from "./combos.js";

export const COMMANDER_BOOST = 3;

export interface SynergyEdge {
  a: string;
  b: string;
  score: number;
  reasons: Reason[];
}

export interface CardSynergy {
  name: string;
  isCommander: boolean;
  score: number;
  partnerCount: number;
  topPartners: { name: string; score: number; reasons: Reason[] }[];
}

export interface DeckReport {
  commanders: string[];
  cards: CardSynergy[];
  edges: SynergyEdge[];
  combos: Combo[];
  themes: { tag: string; count: number }[];
  roles: { ramp: number; draw: number; removal: number };
}

interface Agg {
  name: string;
  score: number;
  partnerCount: number;
  partners: { name: string; score: number; reasons: Reason[]; contribution: number }[];
}

export function analyzeDeck(
  cards: Card[],
  combos?: ComboIndex,
  commanderNames?: string[],
): DeckReport {
  const commanderSet = new Set(commanderNames ?? []);

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

  const agg = new Map<string, Agg>();
  for (const card of cards) {
    agg.set(card.name, { name: card.name, score: 0, partnerCount: 0, partners: [] });
  }
  for (const edge of edges) {
    const boostForA = commanderSet.has(edge.b) ? COMMANDER_BOOST : 1;
    const boostForB = commanderSet.has(edge.a) ? COMMANDER_BOOST : 1;
    const a = agg.get(edge.a);
    const b = agg.get(edge.b);
    if (a) {
      a.score += edge.score * boostForA;
      a.partnerCount += 1;
      a.partners.push({ name: edge.b, score: edge.score, reasons: edge.reasons, contribution: edge.score * boostForA });
    }
    if (b) {
      b.score += edge.score * boostForB;
      b.partnerCount += 1;
      b.partners.push({ name: edge.a, score: edge.score, reasons: edge.reasons, contribution: edge.score * boostForB });
    }
  }

  const cardSynergies: CardSynergy[] = [...agg.values()]
    .map((v) => ({
      name: v.name,
      isCommander: commanderSet.has(v.name),
      score: v.score,
      partnerCount: v.partnerCount,
      topPartners: v.partners
        .sort((x, y) => y.contribution - x.contribution)
        .slice(0, 5)
        .map(({ name, score, reasons }) => ({ name, score, reasons })),
    }))
    .sort(
      (x, y) =>
        y.score - x.score || y.partnerCount - x.partnerCount || x.name.localeCompare(y.name),
    );

  const names = new Set(cards.map((c) => c.name));
  const foundCombos = combos?.combosContainedIn(names) ?? [];
  const presentCommanders = cards.map((c) => c.name).filter((n) => commanderSet.has(n));

  const themeCounts = new Map<Tag, number>();
  const roles = { ramp: 0, draw: 0, removal: 0 };
  for (const card of cards) {
    const { produces } = extractTags(card);
    for (const tag of produces) themeCounts.set(tag, (themeCounts.get(tag) ?? 0) + 1);
    if (produces.has("ramp")) roles.ramp++;
    if (produces.has("card-draw")) roles.draw++;
    if (produces.has("removal")) roles.removal++;
  }
  const themes = [...themeCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((x, y) => y.count - x.count);

  return { commanders: presentCommanders, cards: cardSynergies, edges, combos: foundCombos, themes, roles };
}
