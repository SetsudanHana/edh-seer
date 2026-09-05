import type { Card } from "@edh-seer/engine";
import type { Characteristics } from "./schema.js";
import { CREATURE_SUBTYPES, joinMultiWordSubtypes } from "./derive/subtypes.js";

/** Scryfall type lines use an em dash (U+2014) between types and subtypes. */
const TYPE_SUBTYPE_SEP = " — ";
/** The corpus joins a multi-face card's faces into one line: "Creature — Dog Warlock // Instant". */
const FACE_SEP = " // ";

/** Layouts where only the FRONT face is ever cast or played. The back is reached by transforming
 *  or flipping a permanent already on the battlefield, which is not a zone change: no card enters,
 *  and no spell is cast. This must stay a short ALLOW-list rather than a reject one — everything
 *  else that carries two faces really is playable from either side (a modal DFC, an adventure, a
 *  split card, a `prepare` card's copied spell), and a reject-list would silently narrow whatever
 *  layout gets printed next. */
const FRONT_FACE_ONLY = new Set(["transform", "flip"]);

/** The faces this card can actually be PLAYED as, one at a time — each with its own types and
 *  subtypes, never merged. `undefined` for a single-face card, where the card is its one face and
 *  the union already says everything.
 *
 *  Merging is what the union does, and it is right for what a permanent can BE on the battlefield
 *  and wrong for what enters or is cast. Read as one subject, "Instant // Land" is a land that gets
 *  cast and an instant that enters the battlefield — neither of which happens. Per face it is a
 *  land that enters OR an instant that is cast, which is exactly the card. */
export function playableFaces(typeLine: string, layout?: string): Characteristics["faces"] {
  const parts = typeLine.split(FACE_SEP);
  if (parts.length < 2) return undefined;
  const playable = layout && FRONT_FACE_ONLY.has(layout) ? parts.slice(0, 1) : parts;
  return playable.map((face) => {
    const [types, subtypes] = splitTypeLine(face);
    return { types, subtypes };
  });
}

/** "X IS ALSO A CLERIC, ROGUE, WARRIOR, AND WIZARD" IS THE CARD'S OWN TYPE LINE, printed in the
 *  text box. Four corpus cards say it (Burakos, Party Leader; Stonework Packbeast; Tajuru Paragon;
 *  Veteran Adventurer) and each derived only its printed subtypes, so no Rogue payoff saw Burakos
 *  and his own party count could not count him (owner, 2026-09-05). Only words the closed creature
 *  subtype list knows are admitted: the sentence is read, not trusted. */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function alsoTypes(card: Card): string[] {
  // ANCHORED ON THE CARD'S OWN NAME, never a wildcard prefix: a lazy `[^\n.]{1,60}?` before the
  // verb is polynomial on a run of spaces (CodeQL js/polynomial-redos, PR #191). A legendary card
  // names itself by the part before the comma -- "Burakos is also ..." on Burakos, Party Leader.
  const names = [...new Set([card.name, card.name.split(",")[0]!.trim(), "This creature"])].filter(Boolean);
  const re = new RegExp(`(?:^|\\n)(?:${names.map(escapeRe).join("|")}) is also an? ([^.\\n]{1,80})\\.`);
  const m = re.exec(card.oracleText ?? "");
  if (!m) return [];
  const known = new Set<string>(CREATURE_SUBTYPES);
  // "Cleric, Rogue, Warrior, and Wizard": commas first, then a plain " and " inside each piece, then
  // a leading "and " left by the Oxford comma. String splits, not one alternating regex -- CodeQL
  // flagged `,\s*(?:and\s+)?|\s+and\s+` as polynomial on a run of spaces (PR #191, twice).
  return m[1]!.split(",")
    .flatMap((piece) => piece.split(" and "))
    .map((w) => w.trim().toLowerCase().replace(/^and /, ""))
    .filter((w) => known.has(w));
}

export function extractCharacteristics(card: Card): Characteristics {
  const [left, right] = splitTypeLine(card.typeLine);
  const faces = playableFaces(card.typeLine, card.layout);
  const keywords = card.keywords.map((k) => k.toLowerCase());
  // CHANGELING IS A CHARACTERISTIC-DEFINING ABILITY: the card has EVERY creature type, in every
  // zone — not only on the battlefield, which is why it belongs here and not in an implied event.
  // Scryfall prints the type line as "Creature — Shapeshifter", so without this a changeling matched
  // no typal payoff at all and CLAUDE.md's chosenType rubric ("every changeling is every creature
  // type, so any choice works and all typal edges are real") described behaviour the engine did not
  // have. Applies whatever the card's types: Crib Swap is a Kindred Instant and is still every
  // creature type wherever it sits. 66 corpus cards, 32 inside the normalized set.
  const subtypes = keywords.includes("changeling")
    ? [...new Set([...right, ...CREATURE_SUBTYPES])]
    : [...new Set([...right, ...alsoTypes(card)])];
  return {
    types: left,
    subtypes,
    ...(faces ? { faces } : {}),
    // Carried for the zone rules — see `zoneTypes`. Free: it is already on the card document.
    ...(card.layout ? { layout: card.layout } : {}),
    colors: card.colors,
    identity: card.colorIdentity ?? [],
    cmc: card.manaValue,
    power: card.power ?? null,
    toughness: card.toughness ?? null,
    token: false,
    keywords,
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
    // "Time Lord" is ONE subtype, not two -- see joinMultiWordSubtypes.
    for (const w of joinMultiWordSubtypes(words(subtypesPart))) if (!subtypes.includes(w)) subtypes.push(w);
  }
  return [types, subtypes];
}
