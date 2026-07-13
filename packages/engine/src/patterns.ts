import type { Tag } from "./tags.js";
import { tag } from "./tags.js";
import { type CardView, has, hasClause, matchWord } from "./cardview.js";

export interface Pattern {
  name: string;
  matches(view: CardView): boolean;
  produces?: Tag[] | ((view: CardView) => Tag[]);
  cares?: Tag[] | ((view: CardView) => Tag[]);
}

export const PATTERNS: Pattern[] = [
  // --- Treasure / artifacts ---
  {
    name: "treasure-maker",
    matches: (v) => has(v, "treasure token"),
    produces: ["artifact", "treasure", "token", "mana", "sacrifice-fodder"],
  },
  {
    name: "artifact-payoff",
    matches: (v) =>
      has(v, "an artifact enters", "whenever you cast an artifact", "artifacts you control", "for each artifact"),
    cares: ["artifact"],
  },

  // --- Tokens ---
  {
    name: "creature-token-maker",
    matches: (v) => matchWord(v, /create .*creature token/),
    produces: ["token", "creature-etb", "sacrifice-fodder"],
  },
  {
    name: "token-payoff",
    matches: (v) => has(v, "tokens you control", "for each token", "a token you control"),
    cares: ["token"],
  },
  {
    name: "creature-etb-payoff",
    matches: (v) => has(v, "a creature enters", "another creature enters", "creature you control enters"),
    cares: ["creature-etb"],
  },

  // --- +1/+1 counters ---
  {
    name: "counter-maker",
    matches: (v) => matchWord(v, /put .*\+1\/\+1 counter/) || has(v, "with a +1/+1 counter"),
    produces: () => [tag("counter", "+1/+1")],
  },
  {
    name: "counter-payoff",
    matches: (v) =>
      has(v, "for each +1/+1 counter", "a +1/+1 counter is put", "with +1/+1 counters", "creatures you control with a +1/+1 counter"),
    cares: () => [tag("counter", "+1/+1")],
  },

  // --- Sacrifice / death ---
  {
    name: "sacrifice-outlet",
    // negation-aware: "creatures can't be sacrificed" must not match
    matches: (v) => hasClause(v, "sacrifice a creature", "sacrifice another creature"),
    produces: ["sacrifice-event"],
    cares: ["sacrifice-fodder"],
  },
  {
    name: "death-payoff",
    matches: (v) => hasClause(v, "creature dies", "another creature dies", "a creature you control dies", "whenever a creature dies"),
    cares: ["creature-death", "sacrifice-event"],
  },

  // --- Mana ---
  {
    name: "mana-source",
    matches: (v) => matchWord(v, /add .*mana/) || matchWord(v, /add \{[wubrgc]\}/),
    produces: ["mana"],
  },

  // --- Lands / ramp ---
  {
    name: "ramp",
    matches: (v) => has(v, "search your library for") && has(v, "land") && has(v, "onto the battlefield"),
    produces: ["ramp", "land-etb", "mana"],
  },
  {
    name: "landfall-payoff",
    matches: (v) => has(v, "landfall", "a land enters"),
    cares: ["land-etb"],
  },

  // --- Roles ---
  {
    name: "card-draw",
    matches: (v) => matchWord(v, /draw (a card|two cards|three cards|\w+ cards)/),
    produces: ["card-draw"],
  },
  {
    name: "removal",
    matches: (v) =>
      matchWord(v, /(destroy|exile) target (creature|permanent|artifact|enchantment|planeswalker)/) ||
      has(v, "deals damage to any target", "deals damage to target creature"),
    produces: ["removal"],
  },
];
