import { extractTags, type Card } from "@mtg/engine";
import { normalizeName } from "./names.js";
import type { NormalizedCard } from "./scryfall.js";

export interface CardDoc {
  _id: string;
  name: string;
  typeLine: string;
  oracleText: string;
  keywords: string[];
  colors: string[];
  manaValue: number;
  colorIdentity: string[];
  power: string | null;
  toughness: string | null;
  tags: { produces: string[]; cares: string[] };
  searchNames: string[];
  edhrecRank?: number;
}

export interface ComboDoc {
  _id: string;
  cards: string[];
  result: string;
}

export function toCardDoc(n: NormalizedCard): CardDoc {
  const { produces, cares } = extractTags(n.card);
  const searchNames = Array.from(
    new Set([n.card.name, ...n.faceNames].map(normalizeName)),
  );
  return {
    _id: n.oracleId,
    name: n.card.name,
    typeLine: n.card.typeLine,
    oracleText: n.card.oracleText,
    keywords: n.card.keywords,
    colors: n.card.colors,
    manaValue: n.card.manaValue,
    colorIdentity: n.card.colorIdentity ?? [],
    power: n.card.power ?? null,
    toughness: n.card.toughness ?? null,
    tags: { produces: [...produces], cares: [...cares] },
    searchNames,
    ...(n.edhrecRank !== undefined ? { edhrecRank: n.edhrecRank } : {}),
  };
}

export function docToCard(d: CardDoc): Card {
  return {
    name: d.name,
    typeLine: d.typeLine,
    oracleText: d.oracleText,
    keywords: d.keywords,
    colors: d.colors,
    manaValue: d.manaValue,
    colorIdentity: d.colorIdentity,
    power: d.power,
    toughness: d.toughness,
  };
}
