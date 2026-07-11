import type { Card } from "./card.js";
import { PATTERNS } from "./patterns.js";

export type Tag =
  | "artifact"
  | "treasure"
  | "token"
  | "mana"
  | "sacrifice-fodder"
  | "sacrifice-event"
  | "creature-etb"
  | "creature-death"
  | "+1/+1-counter"
  | "land-etb"
  // role tags (used by analyzeDeck; may also participate in matching)
  | "ramp"
  | "card-draw"
  | "removal";

export function text(card: Card): string {
  return card.oracleText.toLowerCase();
}

export function extractTags(card: Card): { produces: Set<Tag>; cares: Set<Tag> } {
  const produces = new Set<Tag>();
  const cares = new Set<Tag>();
  for (const p of PATTERNS) {
    if (p.matches(card)) {
      p.produces?.forEach((t) => produces.add(t));
      p.cares?.forEach((t) => cares.add(t));
    }
  }
  return { produces, cares };
}
