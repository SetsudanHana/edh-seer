import type { Card } from "@mtg/engine";
import type { Characteristics } from "./schema.js";

/** Scryfall type lines use an em dash (U+2014) between types and subtypes. */
const TYPE_SUBTYPE_SEP = " — ";
/** The corpus joins a multi-face card's faces into one line: "Creature — Dog Warlock // Instant". */
const FACE_SEP = " // ";

/** Layouts where only the FRONT face is ever cast or played. The back is reached by transforming
 *  or flipping a permanent already on the battlefield, which is not a zone change: no card enters,
 *  and no spell is cast. Everything else that carries two faces really is playable from either —
 *  a modal DFC, an adventure, a split card, a `prepare` card's copied spell — so the union of both
 *  faces is the honest answer there and this list must stay a short allow-list, not a reject one. */
const FRONT_FACE_ONLY = new Set(["transform", "flip"]);

/** The front face's types and subtypes, when they are narrower than the union of every face.
 *  `undefined` means "the union already is the front face" — a single-face card, or a layout whose
 *  back face is castable in its own right. */
export function frontFace(typeLine: string, layout?: string): Characteristics["front"] {
  if (!layout || !FRONT_FACE_ONLY.has(layout)) return undefined;
  const [first, ...rest] = typeLine.split(FACE_SEP);
  if (rest.length === 0) return undefined;
  const [types, subtypes] = splitTypeLine(first);
  return { types, subtypes };
}

export function extractCharacteristics(card: Card): Characteristics {
  const [left, right] = splitTypeLine(card.typeLine);
  const front = frontFace(card.typeLine, card.layout);
  return {
    types: left,
    subtypes: right,
    ...(front ? { front } : {}),
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
