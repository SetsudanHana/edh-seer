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
  /** Written by `ingest-meld.ts`, not by `toCardDoc` — re-run that bin after a full re-ingest. */
  meldPartner?: string;
  meldResult?: string;
  meldParts?: string[];
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
    ...(d.meldPartner !== undefined ? { meldPartner: d.meldPartner } : {}),
    // Needed to tell a card castable from either face from one whose back face is only reached in
    // play. Without it `extractCharacteristics` sees "Artifact // Land — Cave" and cannot know that
    // no land ever enters.
    ...(d.layout !== undefined ? { layout: d.layout } : {}),
    // Both were on the documents and dropped here, which is why CLAUDE.md could list producedMana
    // as an available win with nothing consuming it: 2,641 corpus cards carry it and it never
    // reached `Card`. The mana audit is its first consumer.
    ...(d.manaCost !== undefined ? { manaCost: d.manaCost } : {}),
    ...(d.producedMana !== undefined ? { producedMana: d.producedMana } : {}),
    // Same gap as the two fields above, found the same way (Task 6, tokens-as-nodes): `allParts` was
    // on `CardDoc` and dropped here, so `createdTokenRefs` (matcher/tokens.ts) read `[]` off every
    // live `Card` no matter what a card's Scryfall data said -- `population-compare.ts` reported zero
    // token nodes across all 71 calibration decks until this line existed. `Card` does not declare
    // the field (engine cannot depend on `RelatedPart`, which lives here), so `createdTokenRefs`
    // reads it back off an untyped cast, exactly as it already did in its own tests.
    ...(d.allParts !== undefined ? { allParts: d.allParts } : {}),
  };
}
