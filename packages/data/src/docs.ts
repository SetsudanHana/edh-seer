import { extractTags, type Card } from "@mtg/engine";
import { normalizeName } from "./names.js";
import type { CardFace, NormalizedCard, RelatedPart } from "./scryfall.js";

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
  manaCost?: string;
  producedMana?: string[];
  layout?: string;
  /** Kept as a property, not edges: 24 formats across ~35k cards is ~835k edges for one fact. */
  legalities?: Record<string, string>;
  releasedAt?: string;
  gameChanger?: boolean;
  reserved?: boolean;
  allParts?: RelatedPart[];
  faces?: CardFace[];
  artCrop?: string;
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
    ...(n.manaCost !== undefined ? { manaCost: n.manaCost } : {}),
    ...(n.producedMana !== undefined ? { producedMana: n.producedMana } : {}),
    ...(n.layout !== undefined ? { layout: n.layout } : {}),
    ...(n.legalities !== undefined ? { legalities: n.legalities } : {}),
    ...(n.releasedAt !== undefined ? { releasedAt: n.releasedAt } : {}),
    ...(n.gameChanger !== undefined ? { gameChanger: n.gameChanger } : {}),
    ...(n.reserved !== undefined ? { reserved: n.reserved } : {}),
    ...(n.allParts !== undefined ? { allParts: n.allParts } : {}),
    ...(n.faces !== undefined ? { faces: n.faces } : {}),
    ...(n.artCrop !== undefined ? { artCrop: n.artCrop } : {}),
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
