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

  // --- Tokens ---
  {
    name: "creature-token-maker",
    // "create ... creature token(s)" — a token that is also a creature entering.
    matches: (c) => /create .*creature token/.test(oracle(c)),
    produces: ["token", "creature-etb", "sacrifice-fodder"],
  },
  {
    name: "token-payoff",
    matches: (c) => has(c, "tokens you control", "for each token", "a token you control"),
    cares: ["token"],
  },
  {
    name: "creature-etb-payoff",
    matches: (c) => has(c, "a creature enters", "another creature enters", "creature you control enters"),
    cares: ["creature-etb"],
  },

  // --- +1/+1 counters ---
  {
    name: "counter-maker",
    matches: (c) => /put .*\+1\/\+1 counter/.test(oracle(c)) || has(c, "with a +1/+1 counter"),
    produces: ["+1/+1-counter"],
  },
  {
    name: "counter-payoff",
    matches: (c) =>
      has(c, "for each +1/+1 counter", "a +1/+1 counter is put", "with +1/+1 counters", "creatures you control with a +1/+1 counter"),
    cares: ["+1/+1-counter"],
  },

  // --- Sacrifice / death ---
  {
    name: "sacrifice-outlet",
    // "sacrifice a/another creature" appearing before a colon = an activated sac ability.
    matches: (c) => /sacrifice (a|another) creature/.test(oracle(c)),
    produces: ["sacrifice-event"],
    cares: ["sacrifice-fodder"],
  },
  {
    name: "death-payoff",
    matches: (c) => has(c, "creature dies", "another creature dies", "a creature you control dies", "whenever a creature dies"),
    cares: ["creature-death", "sacrifice-event"],
  },

  // --- Mana ---
  {
    name: "mana-source",
    // "add {C}{C}" / "add two colorless mana" / "add one mana of any color" etc.
    matches: (c) => /add .*mana/.test(oracle(c)),
    produces: ["mana"],
  },

  // --- Lands / ramp ---
  {
    name: "ramp",
    matches: (c) =>
      has(c, "search your library for", "onto the battlefield") && has(c, "land"),
    produces: ["ramp", "land-etb", "mana"],
  },
  {
    name: "landfall-payoff",
    matches: (c) => has(c, "landfall", "a land enters"),
    cares: ["land-etb"],
  },

  // --- Roles ---
  {
    name: "card-draw",
    matches: (c) => /draw (a card|two cards|three cards|\w+ cards)/.test(oracle(c)),
    produces: ["card-draw"],
  },
  {
    name: "removal",
    matches: (c) =>
      /(destroy|exile) target (creature|permanent|artifact|enchantment|planeswalker)/.test(oracle(c)) ||
      has(c, "deals damage to any target", "deals damage to target creature"),
    produces: ["removal"],
  },
];
