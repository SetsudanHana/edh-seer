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

const COUNTER_KEYWORDS = ["modular", "graft", "outlast", "training", "mentor", "bloodthirst", "devour", "connive", "monstrosity", "renown"];

const ATTACK_TRIGGER_KEYWORDS = ["exalted", "battle cry", "mentor", "myriad", "melee", "afflict", "dethrone", "boast", "enlist", "annihilator", "double team", "mobilize"];

const GRAVEYARD_KEYWORDS = [
  "delve", "escape", "flashback", "dredge",
  "embalm", "eternalize", "unearth", "encore", "disturb", "aftermath", "jump-start", "retrace", "recover", "scavenge",
  "collect evidence", "forage",
];

const TOKEN_KEYWORDS = ["fabricate", "myriad", "afterlife", "double team", "mobilize", "living weapon", "offspring"];

const ARISTOCRAT_SAC_KEYWORDS = ["exploit", "casualty", "devour"];

const DEATH_VALUE_KEYWORDS = ["afterlife", "blitz"];

const ARTIFACT_COST_KEYWORDS = ["affinity", "improvise"];

const ARTIFACT_TOKEN_KEYWORDS = ["investigate", "food", "incubate"];

const FACEDOWN_KEYWORDS = ["manifest", "cloak", "manifest dread"];

const GRAVEYARD_FILL_KEYWORDS = ["surveil", "manifest dread"];

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
      `\\b(other ${plural}|${plural} you control|each ${singular}|${singular} creatures` +
        `|cast (?:a|an|another) ${singular}|${singular} permanent spell|${singular} spell` +
        `|${singular} spells you control)\\b`,
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
      has(v, "an artifact enters", "whenever you cast an artifact", "artifacts you control", "for each artifact", "metalcraft"),
    cares: ["artifact"],
  },
  {
    name: "cost-reduction-payoff",
    matches: (v) =>
      ARTIFACT_COST_KEYWORDS.some((k) => hasKeyword(v, k)) || hasKeyword(v, "convoke"),
    cares: (v) => {
      const out: Tag[] = [];
      if (ARTIFACT_COST_KEYWORDS.some((k) => hasKeyword(v, k))) out.push("artifact");
      if (hasKeyword(v, "convoke")) out.push("token");
      return out;
    },
  },

  // --- Tokens ---
  {
    name: "creature-token-maker",
    matches: (v) => matchWord(v, /create .*creature token/),
    produces: ["token", "creature-etb", "sacrifice-fodder"],
  },
  {
    name: "token-payoff",
    matches: (v) => has(v, "tokens you control", "for each token", "a token you control", "celebration"),
    cares: ["token"],
  },
  {
    name: "creature-etb-payoff",
    matches: (v) => has(v, "a creature enters", "another creature enters", "creature you control enters"),
    cares: ["creature-etb"],
  },
  {
    name: "token-keyword-maker",
    matches: (v) => TOKEN_KEYWORDS.some((k) => hasKeyword(v, k)) || matchWord(v, /\b(populate|amass)\b/),
    produces: ["token"],
  },
  {
    name: "token-doubler",
    matches: (v) => has(v, "twice that many"),
    cares: ["token"],
  },
  {
    name: "clue-food-maker",
    matches: (v) => ARTIFACT_TOKEN_KEYWORDS.some((k) => hasKeyword(v, k)),
    produces: (v) => {
      const out: Tag[] = ["artifact", "token", "sacrifice-fodder"];
      if (hasKeyword(v, "food")) out.push("lifegain");
      return out;
    },
  },
  {
    name: "facedown-creature-maker",
    matches: (v) => FACEDOWN_KEYWORDS.some((k) => hasKeyword(v, k)),
    produces: ["creature-etb", "sacrifice-fodder"],
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
  {
    name: "counter-keyword-source",
    matches: (v) => COUNTER_KEYWORDS.some((k) => hasKeyword(v, k)) || matchWord(v, /\b(adapt|bolster)\b/),
    produces: () => [tag("counter", "+1/+1")],
  },
  {
    name: "proliferate-payoff",
    matches: (v) => has(v, "proliferate"),
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
    matches: (v) => hasClause(v, "creature dies", "another creature dies", "a creature you control dies", "whenever a creature dies", "creature died", "morbid"),
    cares: ["creature-death", "sacrifice-event"],
  },
  {
    name: "sac-outlet-keyword",
    matches: (v) => ARISTOCRAT_SAC_KEYWORDS.some((k) => hasKeyword(v, k)),
    produces: ["sacrifice-event"],
    cares: ["sacrifice-fodder"],
  },
  {
    name: "death-value-creature",
    matches: (v) => DEATH_VALUE_KEYWORDS.some((k) => hasKeyword(v, k)),
    produces: ["creature-death", "sacrifice-fodder"],
  },

  // --- Graveyard / recursion ---
  {
    name: "self-mill",
    matches: (v) =>
      matchWord(v, /mill \w+ cards?/) ||
      hasClause(v, "into your graveyard", "discard your hand") ||
      GRAVEYARD_FILL_KEYWORDS.some((k) => hasKeyword(v, k)),
    produces: ["graveyard"],
  },
  {
    name: "graveyard-payoff",
    matches: (v) =>
      has(v, "from your graveyard", "in your graveyard", "creature card in your graveyard",
            "threshold", "delirium", "undergrowth", "descend", "descent", "spell mastery") ||
      GRAVEYARD_KEYWORDS.some((k) => hasKeyword(v, k)),
    cares: ["graveyard"],
  },

  // --- Lifegain / aristocrats ---
  {
    name: "lifegain-source",
    matches: (v) =>
      matchWord(v, /gains? (?:\d+\s+)?life/) ||
      has(v, "gain that much life") ||
      hasKeyword(v, "lifelink") ||
      hasKeyword(v, "extort"),
    produces: ["lifegain"],
  },
  {
    name: "lifegain-payoff",
    matches: (v) => has(v, "whenever you gain life", "gained life this turn", "if you gained life"),
    cares: ["lifegain"],
  },

  // --- Blink / flicker ---
  {
    name: "blink-enabler",
    matches: (v) => matchWord(v, /exile [^.]*return [^.]*to the battlefield/) || has(v, "flicker"),
    produces: ["blink"],
    cares: ["creature-etb"],
  },
  {
    name: "etb-value-creature",
    // Own enters-the-battlefield trigger. v.name is case-preserved in toCardView, so
    // the inline .toLowerCase() is required; also accept the generic self-reference.
    matches: (v) =>
      v.types.has("creature") &&
      (v.oracle.includes(`${v.name.toLowerCase()} enters the battlefield`) ||
        v.oracle.includes("this creature enters the battlefield")),
    produces: ["creature-etb"],
    cares: ["blink"],
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
  {
    name: "ramp-payoff",
    // A card costing 6+ mana is what a ramp deck accelerates into; 6 is the
    // common "needs acceleration" line. Closes the produce-only `ramp` tag.
    matches: (v) => v.manaValue >= 6,
    cares: ["ramp"],
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
  {
    name: "chosen-type-payoff",
    matches: (v) =>
      has(v, "choose a creature type", "the chosen type", "of that type",
            "of the chosen type", "creature type of your choice", "shares a creature type"),
    cares: ["tribe:*"],
  },
  {
    name: "changeling-member",
    matches: (v) => hasKeyword(v, "changeling") || has(v, "is every creature type", "all creature types"),
    produces: ["tribe:*"],
  },
  {
    name: "party-payoff",
    matches: (v) => matchWord(v, /\bparty\b/),
    cares: () => [tag("tribe", "cleric"), tag("tribe", "rogue"), tag("tribe", "warrior"), tag("tribe", "wizard")],
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
  {
    name: "spellcast-payoff",
    matches: (v) =>
      hasKeyword(v, "prowess") || hasKeyword(v, "storm") || hasKeyword(v, "surge") ||
      has(v, "whenever you cast a noncreature spell", "your second spell each turn",
            "cast your second spell", "noncreature spells you control cost",
            "instant and sorcery spells you control cost"),
    cares: () => [tag("cast", "instant"), tag("cast", "sorcery")],
  },

  // --- Enchantress ---
  {
    name: "enchantment-permanent",
    matches: (v) => v.types.has("enchantment"),
    produces: ["enchantment"],
  },
  {
    name: "enchantress-payoff",
    matches: (v) =>
      has(v, "whenever you cast an enchantment", "an enchantment you control enters", "constellation", "for each enchantment", "eerie"),
    cares: ["enchantment"],
  },
  {
    name: "aura-permanent",
    // subtype Aura catches printed Auras; bestow creatures are Auras via the
    // keyword (their printed subtype is the creature type, not Aura).
    matches: (v) => v.subtypes.has("aura") || hasKeyword(v, "bestow"),
    produces: ["aura"],
  },
  {
    name: "aura-payoff",
    matches: (v) => has(v, "cast an aura", "aura spell", "for each aura", "auras you control"),
    cares: ["aura"],
  },

  // --- Equipment / Voltron ---
  {
    name: "equipment-permanent",
    matches: (v) => v.subtypes.has("equipment"),
    produces: ["equipment"],
  },
  {
    name: "equipment-payoff",
    matches: (v) =>
      has(v, "equipped creature", "equipment you control", "whenever you attach", "for each equipment"),
    cares: ["equipment"],
  },

  // --- Attack-matters ---
  {
    name: "attacker-trigger",
    // in-clause: "whenever ~ attacks" must not span a sentence period
    matches: (v) =>
      matchWord(v, /when(ever)? [^.]*attacks/) ||
      ATTACK_TRIGGER_KEYWORDS.some((k) => hasKeyword(v, k)) ||
      matchWord(v, /\b(battalion|raid|rally)\b/),
    produces: ["attack-trigger"],
  },
  {
    name: "attack-trigger-payoff",
    matches: (v) =>
      has(v, "whenever a creature you control attacks", "one or more creatures you control attack", "attacking causes a triggered ability"),
    cares: ["attack-trigger"],
  },
];
