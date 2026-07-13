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

// --- Archetype: our strategic tag families (not Scryfall keywords). ---
// Implemented ones are `covered`; attack-matters is `planned` (no pattern yet).
const ARCHETYPES: MechanicEntry[] = [
  { mechanic: "tribal", source: "archetype", status: "covered", tags: ["tribe:goblin"], patterns: ["tribal-member", "tribal-payoff"], note: "parametric tribe:<subtype>" },
  { mechanic: "spellslinger", source: "archetype", status: "covered", tags: ["cast:instant", "cast:sorcery"], patterns: ["spell-caster", "magecraft-payoff"] },
  { mechanic: "artifacts", source: "archetype", status: "covered", tags: ["artifact", "treasure"], patterns: ["treasure-maker", "artifact-payoff"] },
  { mechanic: "tokens", source: "archetype", status: "covered", tags: ["token", "creature-etb"], patterns: ["creature-token-maker", "token-payoff", "creature-etb-payoff"] },
  { mechanic: "counters", source: "archetype", status: "covered", tags: ["counter:+1/+1"], patterns: ["counter-maker", "counter-payoff"] },
  { mechanic: "aristocrats", source: "archetype", status: "covered", tags: ["sacrifice-event", "creature-death", "sacrifice-fodder"], patterns: ["sacrifice-outlet", "death-payoff"] },
  { mechanic: "ramp", source: "archetype", status: "covered", tags: ["ramp", "land-etb", "mana"], patterns: ["ramp", "landfall-payoff", "mana-source"] },
  { mechanic: "card-draw", source: "archetype", status: "covered", tags: ["card-draw"], patterns: ["card-draw"] },
  { mechanic: "removal", source: "archetype", status: "covered", tags: ["removal"], patterns: ["removal"] },
  { mechanic: "enchantress", source: "archetype", status: "covered", tags: ["enchantment"], patterns: ["enchantment-permanent", "enchantress-payoff"] },
  { mechanic: "equipment", source: "archetype", status: "covered", tags: ["equipment"], patterns: ["equipment-permanent", "equipment-payoff"] },
  { mechanic: "attack-matters", source: "archetype", status: "planned", note: "attack/combat-trigger doublers + payoffs (Isshin, 'whenever a creature attacks'); no pattern yet" },
];

// --- Tighten: handled but imprecise (the standing precision backlog). ---
const TIGHTEN: MechanicEntry[] = [
  { mechanic: "graveyard", source: "archetype", status: "tighten", tags: ["graveyard"], patterns: ["self-mill", "graveyard-payoff"], note: "self-mill needles (discard/'from the top of your library') broader than the archetype" },
  { mechanic: "lifegain", source: "archetype", status: "tighten", tags: ["lifegain"], patterns: ["lifegain-source", "lifegain-payoff"], note: "has('gain life') misses 'gains life equal to X' (Swords/Congregate)" },
  { mechanic: "blink", source: "archetype", status: "tighten", tags: ["blink"], patterns: ["blink-enabler", "etb-value-creature"], note: "enabler regex crosses sentence periods; etb self-name heuristic fragile" },
];

// --- Planned: synergy-relevant, no pattern yet. ---
const PLANNED: MechanicEntry[] = [
  // graveyard recursion
  ...["scavenge", "recover", "retrace", "embalm", "eternalize", "unearth", "encore", "disturb", "aftermath", "jump-start"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "planned", note: "graveyard recursion" }),
  ),
  // spellslinger / cast-matters
  ...["prowess", "storm", "cascade", "replicate", "conspire", "buyback", "overload", "surge", "spectacle", "flashback"].filter((m) => m !== "flashback").map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "planned", note: "spellslinger / cast-matters" }),
  ),
  // sacrifice / aristocrats
  ...["exploit", "casualty", "devour", "afterlife", "blitz"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "planned", note: "aristocrats" }),
  ),
  // +1/+1 counters (keyword-abilities; note: `adapt` and `bolster` are keyword-ACTIONS, listed below)
  ...["modular", "graft", "outlast", "training", "renown", "bloodthirst"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "planned", note: "counters" }),
  ),
  // tokens (keyword-abilities)
  ...["fabricate", "myriad", "living weapon", "offspring"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "planned", note: "tokens" }),
  ),
  // mana / ramp
  ...["convoke", "improvise", "affinity", "sunburst"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "planned", note: "mana / cost reduction" }),
  ),
  // enchantress / equipment / voltron
  ...["bestow", "reconfigure", "fortify", "for mirrodin!"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "planned", note: "auras / equipment" }),
  ),
  // lifegain / drain
  ...["extort", "absorb"].map((m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "planned", note: "lifegain / drain" })),
  // attack-matters (combat TRIGGERS — Isshin & attack payoffs)
  ...["exalted", "battle cry", "mentor", "melee", "afflict", "dethrone", "boast", "enlist", "double team", "mobilize", "annihilator"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-ability", status: "planned", note: "attack-matters" }),
  ),
  // keyword-action planned (populate & amass are ACTIONS, not abilities)
  ...["proliferate", "populate", "amass", "adapt", "investigate", "explore", "connive", "surveil", "forage", "collect evidence", "incubate", "food", "bolster", "monstrosity", "manifest", "manifest dread", "cloak", "conjure", "goad"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "keyword-action", status: "planned" }),
  ),
  // ability-word planned (graveyard/threshold, attack-matters, type-matters conditions)
  ...["threshold", "delirium", "undergrowth", "descend", "fathomless descent", "morbid", "revolt", "metalcraft", "domain", "coven", "celebration", "corrupted", "void", "eerie", "survival", "spell mastery", "addendum"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "ability-word", status: "planned" }),
  ),
  ...["battalion", "raid", "pack tactics", "ferocious", "formidable", "valiant", "flurry", "bloodrush", "rally"].map(
    (m): MechanicEntry => ({ mechanic: m, source: "ability-word", status: "planned", note: "attack-matters" }),
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
  ]),
  ...skips("keyword-action", [
    "scry", "seek", "heal", "activate", "attach", "cast", "counter", "destroy", "discard", "exchange",
    "exile", "support", "play", "reveal", "shuffle", "tap", "untap", "vote", "time travel", "transform",
    "planeswalk", "learn", "venture into the dungeon", "regenerate", "open an attraction", "discover",
    "abandon", "roll to visit your attractions", "set in motion", "fateseal", "detain", "clash", "meld",
    "fight", "assemble", "suspect", "role token", "plot", "harness", "draft from a spellbook", "heist",
    "endure", "prepared", "incorporate", "exert", "convert", "waterbend", "airbend", "earthbend", "blight",
    "behold", "double", "triple",
  ]),
  ...skips("ability-word", [
    "channel", "chroma", "cohort", "converge", "fateful hour", "grandeur", "hellbent", "heroic",
    "imprint", "inspired", "join forces", "kinship", "lieutenant", "parley", "radiance", "strive",
    "sweep", "tempting offer", "will of the council", "adamant", "council's dilemma", "eminence",
    "enrage", "hero's reward", "kinfall", "landship", "legacy", "underdog", "alliance", "secret council",
    "paradox", "disappear", "will of the planeswalkers", "start your engines!", "renew", "repartee",
    "opus", "infusion", "covercast", "vivid",
  ]),
];

export const MECHANICS: MechanicEntry[] = [...COVERED, ...ARCHETYPES, ...TIGHTEN, ...PLANNED, ...SKIP];

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
