import type { Card, CardFace } from "@edh-seer/engine";
import type { CardTags, GameEvent } from "@edh-seer/tagger";
import type { DeckCard } from "./types.js";
import { parseTypeLine } from "./typeline.js";

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
 *  a transform back is absent from it (CR 712.8a: the back is reached by transforming a permanent
 *  already in play, never cast or played). So a face that is playable keeps its own single entry and
 *  a face that is not gets an EMPTY list, which is what makes `impliedEvents` give it no `cast` and
 *  no `enters` rather than falling back to the union. */
function faceTags(tags: CardTags, i: number, faces: CardFace[]): CardTags {
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
    abilities: tags.abilities.filter((a) => (a.face ?? 0) === i).map((a) => a.emits?.some(reEntry)
      ? { ...a, emits: a.emits.map((e) => !reEntry(e) ? e
        // A face that SAYS "transformed" but whose emit was not marked is a phrasing derive missed:
        // left untyped rather than read as the front face (Ajani's "return him" did exactly that).
        : e.subject.transformed ? { ...e, subject: { ...e.subject, ...faceClass(faces[1]) } }
        : /\btransformed\b/i.test(faces[i]?.oracleText ?? "") ? e
        : { ...e, subject: { ...e.subject, ...faceClass(faces[0]) } }) }
      : a),
  };
}

/** THE CARD PUTTING ITSELF BACK ONTO THE BATTLEFIELD, untyped: which face enters is a rule, not the
 *  face that printed the ability -- the front by default (CR 712.14), the back when "transformed"
 *  (712.14a). Jill, Shiva's Dominant's flicker returns Shiva, an Enchantment Creature, which is
 *  what Setessan Champion's constellation hears (#715); Shiva's chapter III returns Jill. */
const reEntry = (e: GameEvent): boolean => e.verb === "enters" && e.subject.self === true
  && (e.subject.zone ?? "battlefield") === "battlefield"
  // A TRANSFORMED re-entry is retyped even when the clause's noun typed it: "exile this Saga, then
  // return it transformed" names what LEFT, and Reflection of Kiki-Jiki enters as a creature.
  && (e.subject.transformed === true || (e.subject.type === undefined && e.subject.subtype === undefined));

/** WHICH FACE'S NAME A SELF RE-ENTRY SPEAKS OF, when it is not the face that printed it: "When Jill
 *  enters, Setessan Champion draws" is false -- Shiva is the enchantment that enters (#715). Same
 *  rule, and the same refusal, as the typing in `faceTags`. */
export function enteringFaceName(p: DeckCard, e: GameEvent): string | undefined {
  if (!p.parent || p.face === undefined || !reEntry({ ...e, subject: { ...e.subject, transformed: true } })) return undefined;
  const faces = printedFaces(p.parent.card);
  if (e.subject.transformed) return faces[1]?.name;
  return /\btransformed\b/i.test(faces[p.face]?.oracleText ?? "") ? undefined : faces[0]?.name;
}

function faceClass(face: CardFace | undefined): { type?: string[]; subtype?: string[] } {
  if (!face) return {};
  const p = parseTypeLine(face.typeLine);
  const types = [...p.supertypes, ...p.types];
  return { ...(types.length ? { type: types } : {}), ...(p.subtypes.length ? { subtype: p.subtypes } : {}) };
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
    tags: dc.tags ? faceTags(dc.tags, i, faces) : null,
  }));
}
