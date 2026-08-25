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
  // A BACK-FACE NAME IS NOT A CARD NAME (roadmap I3, owner's fix). Indexing every face made
  // **Studious First-Year // Rampant Growth claim the key `rampant growth`**, so a decklist line
  // "1 Rampant Growth" could resolve to a Bear Wizard — and WHICH doc won was decided by `findOne`
  // order, i.e. by nothing.
  //
  // MEASURED over the 34,433-card corpus: 79 colliding `searchNames` keys, **27 where a FACE name
  // collides with a whole card's NAME — prepare 20, split 6, normal 2** — and the list is famous
  // spells: Lightning Bolt, Brainstorm, Ancestral Recall, Careful Study, Exsanguinate, Sign in
  // Blood, Stream of Life, Replenish, Seething Song.
  //
  // FRONT FACE ONLY IS SAFE ACROSS EVERY MULTI-FACE LAYOUT, because a decklist names a card by its
  // front or by the whole "A // B" string, and both are still indexed. The only thing lost is
  // writing the BACK half of a split alone, which no export format does.
  //
  // AN EMPTY KEY IS DROPPED TOO. It cannot be typed deliberately and it makes any line that cleans
  // to empty resolve at random — see `ingestFlavorNames`, which is the other writer of this field.
  const searchNames = Array.from(
    new Set([n.card.name, ...n.faceNames.slice(0, 1)].map(normalizeName)),
  ).filter((k) => k !== "");
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
    // Third time (see the two notes above): on `CardDoc` since the card-graph work, documented
    // there as "stored, unused", and unused because it never reached `Card`. The bracket rule is
    // its first consumer.
    ...(d.gameChanger !== undefined ? { gameChanger: d.gameChanger } : {}),
  };
}
