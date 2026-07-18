import type { Card } from "@mtg/engine";
import type { Characteristics } from "./schema.js";

/** Scryfall type lines use an em dash (U+2014) between types and subtypes. */
const TYPE_SUBTYPE_SEP = " — ";

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

function splitTypeLine(typeLine: string): [string[], string[]] {
  const [typesPart, subtypesPart = ""] = typeLine.split(TYPE_SUBTYPE_SEP);
  const words = (s: string): string[] =>
    s
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.toLowerCase());
  return [words(typesPart), words(subtypesPart)];
}
