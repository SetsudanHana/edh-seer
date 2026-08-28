import type { Card, CardFace } from "@mtg/engine";
import type { CardTags } from "@mtg/tagger";
import type { DeckCard } from "./types.js";

/** The printed faces of a card. `Card.faces` when the document carries it; otherwise the combined
 *  type line split on " // ", which is a no-op for a genuinely single-faced line. An absent `faces`
 *  does NOT mean single-faced — it can mean a document that was never refreshed, and reading it that
 *  way is how a combined line reaches a type-line parser whole. Same fallback `graph.ts` ships. */
export function printedFaces(card: Card): CardFace[] {
  if (card.faces?.length) return card.faces;
  const lines = card.typeLine.split(" // ");
  if (lines.length < 2) return [];
  const names = card.name.split(" // ");
  const texts = card.oracleText.split("\n");
  return lines.map((typeLine, i) => ({
    name: names[i] ?? names[0] ?? card.name,
    typeLine,
    oracleText: texts[i] ?? "",
    colors: card.colors,
  }));
}

/** Narrow a card's derived tags to ONE face: the abilities that face prints, and its own types.
 *
 *  `characteristics.faces` is the PLAYABLE faces and is a different question from the printed ones —
 *  a transform back is absent from it (CR 712.4a: the back is reached by transforming a permanent
 *  already in play, never cast or played). So a face that is playable keeps its own single entry and
 *  a face that is not gets an EMPTY list, which is what makes `impliedEvents` give it no `cast` and
 *  no `enters` rather than falling back to the union. */
function faceTags(tags: CardTags, i: number, face: CardFace): CardTags {
  const chars = tags.characteristics;
  const playable = i < (chars.faces?.length ?? 1);
  const own = chars.faces?.[i];
  const parsed = own ?? { types: [], subtypes: [] };
  return {
    ...tags,
    characteristics: {
      ...chars,
      ...(own ? { types: own.types, subtypes: own.subtypes } : {}),
      faces: playable ? [parsed] : [],
    },
    abilities: tags.abilities.filter((a) => (a.face ?? 0) === i),
  };
}

/** One `DeckCard` per printed face. A single-face card and a token are returned unchanged, so a
 *  caller can map this over a whole deck without a "does this card have faces" branch. */
export function faceDeckCards(dc: DeckCard): DeckCard[] {
  if (dc.isToken) return [dc];
  const faces = printedFaces(dc.card);
  if (faces.length < 2) return [dc];
  return faces.map((f, i) => ({
    ...dc,
    face: i,
    parentName: dc.card.name,
    parent: dc,
    card: {
      ...dc.card,
      name: f.name,
      typeLine: f.typeLine,
      oracleText: f.oracleText,
      ...(f.manaCost !== undefined ? { manaCost: f.manaCost } : {}),
      colors: f.colors.length > 0 ? f.colors : f.colorIndicator ?? dc.card.colors,
    },
    tags: dc.tags ? faceTags(dc.tags, i, f) : null,
  }));
}
