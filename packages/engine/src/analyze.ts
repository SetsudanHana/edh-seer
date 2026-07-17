import { readFileSync } from "node:fs";
import type { Card } from "./card.js";
import { synergyScore, type Reason } from "./synergy.js";
import { extractTags, type Tag } from "./tags.js";
import type { Combo, ComboIndex } from "./combos.js";
import { themeWeights, rankThemes, weightedEdge, dampedScore, computeCohesion, type TagStats, type Cohesion } from "./weights.js";

const TAG_STATS: TagStats = JSON.parse(
  readFileSync(new URL("./tag-weights.json", import.meta.url), "utf8"),
) as TagStats;

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
  cohesion: Cohesion | null;
}

interface Agg {
  name: string;
  weighted: number;
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

  // Deck-local tag frequency: cards whose produces ∪ cares contains the tag.
  const deckFreq = new Map<Tag, number>();
  for (const card of cards) {
    const { produces, cares } = extractTags(card);
    for (const t of new Set<Tag>([...produces, ...cares])) {
      deckFreq.set(t, (deckFreq.get(t) ?? 0) + 1);
    }
  }
  const tw = themeWeights(deckFreq, TAG_STATS);
  const weightOf = (t: string): number => tw.get(t) ?? 0;

  const agg = new Map<string, Agg>();
  for (const card of cards) {
    agg.set(card.name, { name: card.name, weighted: 0, partnerCount: 0, partners: [] });
  }
  for (const edge of edges) {
    const w = weightedEdge(edge.reasons, weightOf);
    const boostForA = commanderSet.has(edge.b) ? COMMANDER_BOOST : 1;
    const boostForB = commanderSet.has(edge.a) ? COMMANDER_BOOST : 1;
    const a = agg.get(edge.a);
    const b = agg.get(edge.b);
    if (a) {
      a.weighted += w * boostForA;
      a.partnerCount += 1;
      a.partners.push({ name: edge.b, score: edge.score, reasons: edge.reasons, contribution: w * boostForA });
    }
    if (b) {
      b.weighted += w * boostForB;
      b.partnerCount += 1;
      b.partners.push({ name: edge.a, score: edge.score, reasons: edge.reasons, contribution: w * boostForB });
    }
  }

  const cardSynergies: CardSynergy[] = [...agg.values()]
    .map((v) => ({
      name: v.name,
      isCommander: commanderSet.has(v.name),
      score: dampedScore(v.weighted, v.partnerCount),
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

  const nonlandCount = cards.filter((c) => !c.typeLine.toLowerCase().includes("land")).length;
  const cohesion = computeCohesion(rankThemes(deckFreq, TAG_STATS), deckFreq, nonlandCount);

  return { commanders: presentCommanders, cards: cardSynergies, edges, combos: foundCombos, themes, roles, cohesion };
}
