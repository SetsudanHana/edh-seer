import type { Tag } from "./tags.js";

export type MechanicSource = "keyword-ability" | "keyword-action" | "ability-word" | "archetype";
export type MechanicStatus = "covered" | "tighten" | "planned" | "skip";

export interface MechanicEntry {
  mechanic: string;
  source: MechanicSource;
  status: MechanicStatus;
  tags?: Tag[];
  patterns?: string[];
  note?: string;
}

/** Build `skip` entries from a bare name list (keeps the bulk of the registry DRY). */
function skips(source: MechanicSource, names: string[]): MechanicEntry[] {
  return names.map((mechanic) => ({ mechanic, source, status: "skip" as const }));
}

// --- Covered: a current tag + pattern reliably handles this keyword ---
const COVERED: MechanicEntry[] = [
  { mechanic: "sacrifice", source: "keyword-action", status: "covered", tags: ["sacrifice-event"], patterns: ["sacrifice-outlet"] },
  { mechanic: "mill", source: "keyword-action", status: "covered", tags: ["graveyard"], patterns: ["self-mill"] },
  { mechanic: "treasure", source: "keyword-action", status: "covered", tags: ["treasure", "artifact", "mana"], patterns: ["treasure-maker"] },
  { mechanic: "create", source: "keyword-action", status: "covered", tags: ["token"], patterns: ["creature-token-maker"] },
  { mechanic: "lifelink", source: "keyword-ability", status: "covered", tags: ["lifegain"], patterns: ["lifegain-source"] },
  { mechanic: "delve", source: "keyword-ability", status: "covered", tags: ["graveyard"], patterns: ["graveyard-payoff"] },
  { mechanic: "escape", source: "keyword-ability", status: "covered", tags: ["graveyard"], patterns: ["graveyard-payoff"] },
  { mechanic: "flashback", source: "keyword-ability", status: "covered", tags: ["graveyard"], patterns: ["graveyard-payoff"] },
  { mechanic: "dredge", source: "keyword-ability", status: "covered", tags: ["graveyard"], patterns: ["graveyard-payoff"] },
  { mechanic: "equip", source: "keyword-ability", status: "covered", tags: ["equipment"], patterns: ["equipment-permanent", "equipment-payoff"] },
  { mechanic: "enchant", source: "keyword-ability", status: "covered", tags: ["enchantment"], patterns: ["enchantment-permanent"] },
  { mechanic: "landfall", source: "ability-word", status: "covered", tags: ["land-etb"], patterns: ["landfall-payoff"] },
  { mechanic: "magecraft", source: "ability-word", status: "covered", tags: ["cast:instant", "cast:sorcery"], patterns: ["magecraft-payoff"] },
  { mechanic: "constellation", source: "ability-word", status: "covered", tags: ["enchantment"], patterns: ["enchantress-payoff"] },
];

const COVERED_BATCH2: MechanicEntry[] = [
  // +1/+1 counters
  ...["modular", "graft", "outlast", "training", "bloodthirst"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "covered", tags: ["counter:+1/+1"], patterns: ["counter-keyword-source"] }),
  ),
  ...["adapt", "bolster"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-action", status: "covered", tags: ["counter:+1/+1"], patterns: ["counter-keyword-source"] }),
  ),
  { mechanic: "proliferate", source: "keyword-action", status: "covered", tags: ["counter:+1/+1"], patterns: ["proliferate-payoff"] },
  // attack-matters
  ...["exalted", "battle cry", "melee", "afflict", "dethrone", "boast", "enlist", "annihilator"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "covered", tags: ["attack-trigger"], patterns: ["attacker-trigger"] }),
  ),
  ...["battalion", "raid"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "ability-word", status: "covered", tags: ["attack-trigger"], patterns: ["attacker-trigger"] }),
  ),
  // mentor & myriad are multi-tag
  { mechanic: "mentor", source: "keyword-ability", status: "covered", tags: ["counter:+1/+1", "attack-trigger"], patterns: ["counter-keyword-source", "attacker-trigger"] },
  { mechanic: "myriad", source: "keyword-ability", status: "covered", tags: ["attack-trigger", "token"], patterns: ["attacker-trigger", "token-keyword-maker"] },
  // graveyard-recursion
  ...["scavenge", "recover", "retrace", "embalm", "eternalize", "unearth", "encore", "disturb", "aftermath", "jump-start"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "covered", tags: ["graveyard"], patterns: ["graveyard-payoff"] }),
  ),
  // tokens
  { mechanic: "fabricate", source: "keyword-ability", status: "covered", tags: ["token"], patterns: ["token-keyword-maker"] },
  ...["populate", "amass"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-action", status: "covered", tags: ["token"], patterns: ["token-keyword-maker"] }),
  ),
];

const COVERED_BATCH3: MechanicEntry[] = [
  // spellslinger cast-matters payoffs
  ...["prowess", "storm", "surge"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "covered", tags: ["cast:instant", "cast:sorcery"], patterns: ["spellcast-payoff"] }),
  ),
];

const COVERED_BATCH4: MechanicEntry[] = [
  // aristocrats
  ...["exploit", "casualty"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "covered", tags: ["sacrifice-event"], patterns: ["sac-outlet-keyword"] }),
  ),
  { mechanic: "devour", source: "keyword-ability", status: "covered", tags: ["sacrifice-event", "counter:+1/+1"], patterns: ["sac-outlet-keyword", "counter-keyword-source"] },
  { mechanic: "afterlife", source: "keyword-ability", status: "covered", tags: ["creature-death", "sacrifice-fodder", "token"], patterns: ["death-value-creature", "token-keyword-maker"] },
  { mechanic: "blitz", source: "keyword-ability", status: "covered", tags: ["creature-death", "sacrifice-fodder"], patterns: ["death-value-creature"] },
];

const COVERED_BATCH5: MechanicEntry[] = [
  // mana / cost-reduction payoffs
  ...["affinity", "improvise"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "covered", tags: ["artifact"], patterns: ["cost-reduction-payoff"] }),
  ),
  { mechanic: "convoke", source: "keyword-ability", status: "covered", tags: ["token"], patterns: ["cost-reduction-payoff"] },
];

const COVERED_BATCH6: MechanicEntry[] = [
  // artifact-token makers (Clue / Food / Incubator)
  ...["investigate", "incubate"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-action", status: "covered", tags: ["artifact", "token", "sacrifice-fodder"], patterns: ["clue-food-maker"] }),
  ),
  { mechanic: "food", source: "keyword-action", status: "covered", tags: ["artifact", "token", "sacrifice-fodder", "lifegain"], patterns: ["clue-food-maker"] },
  // face-down creature makers
  ...["manifest", "cloak"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-action", status: "covered", tags: ["creature-etb", "sacrifice-fodder"], patterns: ["facedown-creature-maker"] }),
  ),
  { mechanic: "manifest dread", source: "keyword-action", status: "covered", tags: ["creature-etb", "sacrifice-fodder", "graveyard"], patterns: ["facedown-creature-maker", "self-mill"] },
  // graveyard fill / payoff
  { mechanic: "surveil", source: "keyword-action", status: "covered", tags: ["graveyard"], patterns: ["self-mill"] },
  ...["collect evidence", "forage"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-action", status: "covered", tags: ["graveyard"], patterns: ["graveyard-payoff"] }),
  ),
  // counter producers
  ...["connive", "monstrosity"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-action", status: "covered", tags: ["counter:+1/+1"], patterns: ["counter-keyword-source"] }),
  ),
];

const COVERED_BATCH7: MechanicEntry[] = [
  { mechanic: "bestow", source: "keyword-ability", status: "covered", tags: ["aura", "enchantment"], patterns: ["aura-permanent", "enchantment-permanent"] },
  { mechanic: "reconfigure", source: "keyword-ability", status: "covered", tags: ["equipment"], patterns: ["equipment-permanent"] },
  { mechanic: "for mirrodin!", source: "keyword-ability", status: "covered", tags: ["equipment"], patterns: ["equipment-permanent"] },
];

const COVERED_BATCH8: MechanicEntry[] = [
  ...["double team", "mobilize"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "covered", tags: ["attack-trigger", "token"], patterns: ["attacker-trigger", "token-keyword-maker"] }),
  ),
  { mechanic: "rally", source: "ability-word", status: "covered", tags: ["attack-trigger"], patterns: ["attacker-trigger"] },
];

const COVERED_BATCH9: MechanicEntry[] = [
  ...["threshold", "delirium", "undergrowth", "descend", "fathomless descent", "spell mastery"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "ability-word", status: "covered", tags: ["graveyard"], patterns: ["graveyard-payoff"] }),
  ),
  { mechanic: "morbid", source: "ability-word", status: "covered", tags: ["creature-death"], patterns: ["death-payoff"] },
];

const COVERED_BATCH10: MechanicEntry[] = [
  { mechanic: "extort", source: "keyword-ability", status: "covered", tags: ["lifegain"], patterns: ["lifegain-source"] },
];

// --- Archetype: our strategic tag families (not Scryfall keywords). ---
const ARCHETYPES: MechanicEntry[] = [
  { mechanic: "tribal", source: "archetype", status: "covered", tags: ["tribe:goblin"], patterns: ["tribal-member", "tribal-payoff"], note: "parametric tribe:<subtype>" },
  { mechanic: "spellslinger", source: "archetype", status: "covered", tags: ["cast:instant", "cast:sorcery"], patterns: ["spell-caster", "magecraft-payoff"] },
  { mechanic: "artifacts", source: "archetype", status: "covered", tags: ["artifact", "treasure"], patterns: ["treasure-maker", "artifact-payoff"] },
  { mechanic: "tokens", source: "archetype", status: "covered", tags: ["token", "creature-etb"], patterns: ["creature-token-maker", "token-payoff", "creature-etb-payoff"] },
  { mechanic: "counters", source: "archetype", status: "covered", tags: ["counter:+1/+1"], patterns: ["counter-maker", "counter-payoff"] },
  { mechanic: "aristocrats", source: "archetype", status: "covered", tags: ["sacrifice-event", "creature-death", "sacrifice-fodder"], patterns: ["sacrifice-outlet", "death-payoff"] },
  { mechanic: "ramp", source: "archetype", status: "covered", tags: ["ramp", "land-etb", "mana"], patterns: ["ramp", "landfall-payoff", "mana-source", "ramp-payoff"] },
  { mechanic: "card-draw", source: "archetype", status: "covered", tags: ["card-draw"], patterns: ["card-draw"] },
  { mechanic: "removal", source: "archetype", status: "covered", tags: ["removal"], patterns: ["removal"] },
  { mechanic: "enchantress", source: "archetype", status: "covered", tags: ["enchantment"], patterns: ["enchantment-permanent", "enchantress-payoff"] },
  { mechanic: "equipment", source: "archetype", status: "covered", tags: ["equipment"], patterns: ["equipment-permanent", "equipment-payoff"] },
  { mechanic: "auras", source: "archetype", status: "covered", tags: ["aura"], patterns: ["aura-permanent", "aura-payoff"] },
  { mechanic: "attack-matters", source: "archetype", status: "covered", tags: ["attack-trigger"], patterns: ["attacker-trigger", "attack-trigger-payoff"] },
  { mechanic: "graveyard", source: "archetype", status: "covered", tags: ["graveyard"], patterns: ["self-mill", "graveyard-payoff"] },
  { mechanic: "lifegain", source: "archetype", status: "covered", tags: ["lifegain"], patterns: ["lifegain-source", "lifegain-payoff"] },
  { mechanic: "blink", source: "archetype", status: "covered", tags: ["blink"], patterns: ["blink-enabler", "etb-value-creature"] },
];

// --- Planned: synergy-relevant, no pattern yet. ---
const PLANNED: MechanicEntry[] = [
  // +1/+1 counters (keyword-abilities; note: `adapt` and `bolster` are keyword-ACTIONS, listed below)
  ...["renown"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "planned", note: "counters" }),
  ),
  // tokens (keyword-abilities)
  ...["living weapon", "offspring"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "planned", note: "tokens" }),
  ),
  // ability-word planned (non-graveyard conditions: artifact/type/permanent-count axes, future batches)
  ...["metalcraft", "domain", "coven", "celebration", "corrupted", "void", "eerie", "survival", "addendum"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "ability-word", status: "planned" }),
  ),
];

// --- Skip: no plausible synergy axis (pure evasion / combat-math / cosmetic). ---
// Filled from mechanics.catalog.json: every snapshot keyword not classified above.
// Attack/combat-TRIGGER keywords are excluded here and live in PLANNED (attack-matters) instead.
const SKIP: MechanicEntry[] = [
  ...skips("keyword-ability", [
    // pure evasion / combat-math / cosmetic
    "flying", "trample", "vigilance", "menace", "reach", "deathtouch", "haste", "hexproof",
    "indestructible", "defender", "first strike", "double strike", "shroud", "ward",
    "intimidate", "fear", "horsemanship", "skulk", "protection", "flanking", "banding",
    "rampage", "provoke", "frenzy", "bushido", "dash",
    // Fortifications attach to lands (~4 cards exist); no cross-card producer/payoff axis
    "fortify",
    // Absorb N is damage prevention, not lifegain/drain — no cross-card synergy axis
    "absorb",
    // set-mechanic one-offs / cosmetic / cost variants / landwalk & cycling variants, no cross-card synergy
    "commander ninjutsu", "ninjutsu", "legendary landwalk", "nonbasic landwalk", "megamorph", "morph",
    "haunt", "forecast", "gravestorm", "hideaway", "level up", "infect", "phasing", "multikicker",
    "poisonous", "reinforce", "persist", "rebound", "miracle", "soulshift", "splice", "transmute",
    "ripple", "suspend", "vanishing", "transfigure", "wither", "undying", "soulbond", "unleash",
    "ascend", "assist", "companion", "fuse", "ingest", "partner", "mutate", "tribute", "riot",
    "forestwalk", "islandwalk", "mountainwalk", "cumulative upkeep", "amplify", "aura swap",
    "changeling", "cipher", "awaken", "crew", "foretell", "fading", "entwine", "epic", "evoke",
    "evolve", "devoid", "emerge", "escalate", "kicker", "madness", "swampwalk", "desertwalk", "craft",
    "plainswalk", "split second", "augment", "double agenda", "partner with", "daybound", "nightbound",
    "decayed", "squad", "read ahead", "ravenous", "offering", "living metal", "backup", "hidden agenda",
    "friends forever", "compleated", "flash", "landwalk", "typecycling", "demonstrate", "cycling",
    "hexproof from", "landcycling", "more than meets the eye", "cleave", "champion", "specialize",
    "prototype", "toxic", "intensity", "disguise", "slivercycling", "plainscycling", "swampcycling",
    "basic landcycling", "islandcycling", "mountaincycling", "forestcycling", "wizardcycling", "bargain",
    "doctor's companion", "choose a background", "echo", "umbra armor", "freerunning", "spree", "saddle",
    "shadow", "warp", "station", "undaunted", "gift", "impending", "harmonize", "exhaust", "max speed",
    "tiered", "job select", "mayhem", "web-slinging", "prowl", "solved", "sneak", "increment", "paradigm",
    "teamwork", "firebending", "power-up",
    // spellslinger single-spell value: no cross-card producer/payoff axis
    "cascade", "replicate", "conspire", "buyback", "overload", "spectacle",
    // 5-color-mana gated; no clean cross-card producer/payoff axis
    "sunburst",
  ]),
  ...skips("keyword-action", [
    "scry", "seek", "heal", "activate", "attach", "cast", "counter", "destroy", "discard", "exchange",
    "exile", "support", "play", "reveal", "shuffle", "tap", "untap", "vote", "time travel", "transform",
    "planeswalk", "learn", "venture into the dungeon", "regenerate", "open an attraction", "discover",
    "abandon", "roll to visit your attractions", "set in motion", "fateseal", "detain", "clash", "meld",
    "fight", "assemble", "suspect", "role token", "plot", "harness", "draft from a spellbook", "heist",
    "endure", "prepared", "incorporate", "exert", "convert", "waterbend", "airbend", "earthbend", "blight",
    "behold", "double", "triple",
    // no cross-card synergy axis: explore is conditional card-selection; conjure is hand advantage; goad is political/combat
    "explore", "conjure", "goad",
  ]),
  ...skips("ability-word", [
    "channel", "chroma", "cohort", "converge", "fateful hour", "grandeur", "hellbent", "heroic",
    "imprint", "inspired", "join forces", "kinship", "lieutenant", "parley", "radiance", "strive",
    "sweep", "tempting offer", "will of the council", "adamant", "council's dilemma", "eminence",
    "enrage", "hero's reward", "kinfall", "landship", "legacy", "underdog", "alliance", "secret council",
    "paradox", "disappear", "will of the planeswalkers", "start your engines!", "renew", "repartee",
    "opus", "infusion", "covercast", "vivid",
    // power/attack conditions with no cross-card producer/payoff axis; valiant (target-triggered) and flurry (second-spell) are not attack-matters
    "pack tactics", "ferocious", "formidable", "valiant", "flurry", "bloodrush",
    // "a permanent left the battlefield this turn" — broader than any current tag (sac/fetch/blink); no clean axis
    "revolt",
  ]),
];

export const MECHANICS: MechanicEntry[] = [...COVERED, ...COVERED_BATCH2, ...COVERED_BATCH3, ...COVERED_BATCH4, ...COVERED_BATCH5, ...COVERED_BATCH6, ...COVERED_BATCH7, ...COVERED_BATCH8, ...COVERED_BATCH9, ...COVERED_BATCH10, ...ARCHETYPES, ...PLANNED, ...SKIP];

export interface MechanicCoverageSummary {
  total: number;
  byStatus: Record<MechanicStatus, number>;
  tighten: MechanicEntry[];
  planned: MechanicEntry[];
}

export function mechanicCoverageSummary(entries: MechanicEntry[] = MECHANICS): MechanicCoverageSummary {
  const byStatus: Record<MechanicStatus, number> = { covered: 0, tighten: 0, planned: 0, skip: 0 };
  for (const m of entries) byStatus[m.status]++;
  return {
    total: entries.length,
    byStatus,
    tighten: entries.filter((m) => m.status === "tighten"),
    planned: entries.filter((m) => m.status === "planned"),
  };
}
