import type { Card } from "./card.js";
import type { Tag } from "./tags.js";

export interface Pattern {
  name: string;
  matches(card: Card): boolean;
  produces?: Tag[];
  cares?: Tag[];
}

/** Lowercased oracle text. Duplicated here to avoid an import cycle with tags.ts. */
function oracle(card: Card): string {
  return card.oracleText.toLowerCase();
}

/** True if the oracle text contains any of the given substrings. */
function has(card: Card, ...needles: string[]): boolean {
  const o = oracle(card);
  return needles.some((n) => o.includes(n));
}

export const PATTERNS: Pattern[] = [
  {
    name: "treasure-maker",
    matches: (c) => has(c, "treasure token"),
    // A Treasure is an artifact + a token, taps for mana, and is sacrifice fodder.
    produces: ["artifact", "treasure", "token", "mana", "sacrifice-fodder"],
  },
  {
    name: "artifact-payoff",
    matches: (c) =>
      has(c, "an artifact enters", "whenever you cast an artifact", "artifacts you control", "for each artifact"),
    cares: ["artifact"],
  },
];
