import type { Card } from "@mtg/engine";
import type { Characteristics } from "./schema.js";

/** Scryfall type lines use an em dash (U+2014) between types and subtypes. */
const TYPE_SUBTYPE_SEP = " — ";
/** The corpus joins a multi-face card's faces into one line: "Creature — Dog Warlock // Instant". */
const FACE_SEP = " // ";

export function extractCharacteristics(card: Card): Characteristics {
  const [left, right] = splitTypeLine(card.typeLine);
  return {
    types: left,
    subtypes: right,
    colors: card.colors,
    identity: card.colorIdentity ?? [],
    cmc: card.manaValue,
    power: card.power ?? null,
    toughness: card.toughness ?? null,
    token: false,
    keywords: card.keywords.map((k) => k.toLowerCase()),
  };
}

/** Types and subtypes across EVERY face, deduped.
 *
 *  Splitting on the em dash alone treated a joined line as one face, so face 2 was swallowed into
 *  face 1's subtypes: "Creature — Dog Warlock // Instant" produced
 *  subtypes ["dog","warlock","//","instant"] and did NOT type the card as an instant. That is a
 *  missing type plus separator junk on 116 of the 2,544 calibration cards — every multi-face one.
 *
 *  Both faces contribute, because the card genuinely has both: an Instant // Land is a land you can
 *  play AND an instant you can cast, and a subject filtering on either type should match it. */
export function splitTypeLine(typeLine: string): [string[], string[]] {
  const words = (s: string): string[] =>
    s.trim().split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());

  const types: string[] = [];
  const subtypes: string[] = [];
  for (const face of typeLine.split(FACE_SEP)) {
    const [typesPart, subtypesPart = ""] = face.split(TYPE_SUBTYPE_SEP);
    for (const w of words(typesPart)) if (!types.includes(w)) types.push(w);
    for (const w of words(subtypesPart)) if (!subtypes.includes(w)) subtypes.push(w);
  }
  return [types, subtypes];
}
