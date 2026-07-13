import type { Tag } from "./tags.js";
import { tag } from "./tags.js";
import { type CardView, has, hasClause, hasKeyword, matchWord } from "./cardview.js";

export interface Pattern {
  name: string;
  matches(view: CardView): boolean;
  produces?: Tag[] | ((view: CardView) => Tag[]);
  cares?: Tag[] | ((view: CardView) => Tag[]);
}

// A curated set of common EDH creature types, used to keep the tribal PAYOFF side
// precise ("Artifacts you control" must not become tribe:artifact). The PRODUCER
// side reads subtypes straight off the type line, so it needs no list.
const CREATURE_TYPES = new Set([
  "goblin", "elf", "zombie", "human", "wizard", "soldier", "warrior", "cleric", "rogue",
  "dragon", "vampire", "angel", "demon", "beast", "cat", "dog", "bird", "snake", "spider",
  "elemental", "spirit", "merfolk", "faerie", "knight", "pirate", "dinosaur", "hydra",
  "sliver", "saproling", "myr", "construct", "golem", "elephant", "wolf", "werewolf",
  "treefolk", "giant", "shaman", "druid", "assassin", "ninja", "samurai", "monk",
]);

const IRREGULAR_PLURALS: Record<string, string> = {
  elf: "elves",
  wolf: "wolves",
  werewolf: "werewolves",
  dwarf: "dwarves",
};

function pluralOrSingular(word: string): [string, string] {
  if (word.endsWith("s")) return [word, word.slice(0, -1)];
  const plural = IRREGULAR_PLURALS[word] ?? `${word}s`;
  return [plural, word];
}

function tribalCares(view: CardView): Tag[] {
  const out: Tag[] = [];
  for (const type of CREATURE_TYPES) {
    const [plural, singular] = pluralOrSingular(type);
    // Word-boundary match so "each golem" does not fire on "each golemancer".
    const re = new RegExp(
      `\\b(other ${plural}|${plural} you control|each ${singular}|${singular} creatures)\\b`,
    );
    if (matchWord(view, re)) out.push(tag("tribe", type));
  }
  return out;
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

  // --- Graveyard / recursion ---
  {
    name: "self-mill",
    matches: (v) =>
      matchWord(v, /mill \w+ cards?/) ||
      hasClause(v, "into your graveyard", "from the top of your library", "discard a card", "discard your hand"),
    produces: ["graveyard"],
  },
  {
    name: "graveyard-payoff",
    matches: (v) =>
      has(v, "from your graveyard", "in your graveyard", "creature card in your graveyard") ||
      hasKeyword(v, "delve") || hasKeyword(v, "escape") || hasKeyword(v, "flashback") || hasKeyword(v, "dredge"),
    cares: ["graveyard"],
  },

  // --- Lifegain / aristocrats ---
  {
    name: "lifegain-source",
    matches: (v) => matchWord(v, /gains? \d+ life/) || has(v, "gain life") || hasKeyword(v, "lifelink"),
    produces: ["lifegain"],
  },
  {
    name: "lifegain-payoff",
    matches: (v) => has(v, "whenever you gain life", "gained life this turn", "if you gained life"),
    cares: ["lifegain"],
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

  // --- Tribal / kindred (showcase) ---
  {
    name: "tribal-member",
    matches: (v) => v.types.has("creature") && v.subtypes.size > 0,
    produces: (v) => [...v.subtypes].map((s) => tag("tribe", s)),
  },
  {
    name: "tribal-payoff",
    matches: (v) => tribalCares(v).length > 0,
    cares: (v) => tribalCares(v),
  },

  // --- Spellslinger (showcase) ---
  {
    name: "spell-caster",
    matches: (v) => v.types.has("instant") || v.types.has("sorcery"),
    produces: (v) => {
      const out: Tag[] = [];
      if (v.types.has("instant")) out.push(tag("cast", "instant"));
      if (v.types.has("sorcery")) out.push(tag("cast", "sorcery"));
      return out;
    },
  },
  {
    name: "magecraft-payoff",
    matches: (v) =>
      has(v, "magecraft", "whenever you cast an instant or sorcery", "instant and sorcery spells", "instant or sorcery spell", "cast or copy an instant or sorcery"),
    cares: () => [tag("cast", "instant"), tag("cast", "sorcery")],
  },
];
