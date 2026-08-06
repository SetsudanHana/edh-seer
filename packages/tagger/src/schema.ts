export const SCHEMA_VERSION = 1;

export type Control = "you" | "opp" | "any";

export const STAT_METRICS = ["power", "toughness", "mana-value"] as const;
export const STAT_OPS = ["lte", "gte", "lt", "gt", "eq"] as const;
export type StatMetric = (typeof STAT_METRICS)[number];
export type StatOp = (typeof STAT_OPS)[number];

/** A numeric condition on a subject's stat. Exactly one of `value` (constant rhs, e.g. power ≤ 2)
 *  or `vs` (another metric rhs, e.g. toughness ≥ power) is set. */
export interface StatPredicate {
  metric: StatMetric;
  op: StatOp;
  value?: number;
  vs?: "power" | "toughness";
}

/** A characteristic filter: what a trigger cares about, or what an effect targets/produces. */
export interface SubjectFilter {
  /** A card type, or an array of types meaning OR (e.g. ["instant","sorcery"]). */
  type?: string | string[];
  /** A subtype, or an array meaning OR (e.g. ["faerie","wizard"]). */
  subtype?: string | string[];
  colors?: string[];
  /** The subject IS the card whose ability this is ("when THIS creature enters", or the card named
   *  by its own name). Set by derivation from the clause text, which is the only layer that can see
   *  it: parseSubject reduces "this creature" and "another creature you control" to the same
   *  {type: creature}, so without this the matcher cannot tell a self-ETB from a real payoff -- the
   *  defect behind 74% of the false edges in the 2026-08-05 precision measurement. */
  self?: true;
  control: Control;
  /** false = nontoken only, true = token only, null = any. */
  token: boolean | null;
  /** Marks "the chosen type" (Kindred Discovery); resolved deck-aware in Stage 2. */
  chosenType?: boolean;
  /** Counter kind for `counter-added` events, e.g. "+1/+1", "-1/-1", "loyalty". */
  counter?: string;
  /** Zone the subject lives in; omitted means battlefield. E.g. "graveyard", "hand", "exile". */
  zone?: string;
  /** Zone the subject came FROM, when the text names one: "casts a spell from a graveyard" (River
   *  Kelpie), "casts a legendary spell from your hand" (Jodah), "enters from a graveyard".
   *
   *  Separate from `zone`, which says where the subject LIVES. The two cannot share a field:
   *  `normalizeZoneEvent` stamps zone "battlefield" onto every `enters` event, so an origin stored
   *  there would be overwritten — and on the producer side `zone: "graveyard"` on an `enters` means
   *  a graveyard FILL, which `graveyardFillMatches` reads. Unset means any origin, so the constraint
   *  is opt-in and a producer that never records one keeps every edge it has today. */
  fromZone?: string;
  /** Quantifier the text used for this subject. "target creature" is spot removal, "each creature
   *  your opponents control" is a board wipe, and "creatures you control" is an anthem rather than
   *  a pump — a distinction `SubjectFilter` could not previously express at all. Optional and
   *  additive: no consumer reads it yet (the wipe-vs-spot call still happens in matcher's
   *  `build.ts` via BOARD_WIPE_RE against raw oracle text). Derived now because the clause text is
   *  in hand, so asking the question later costs a re-derive rather than a re-grind. */
  scope?: "target" | "each" | "all";
  /** Authored numeric conditions; ALL must hold (ANDed with the rest of the subject). */
  stats?: StatPredicate[];
  /** Concrete stat values the MATCHER attaches to a producer subject (never authored by the LLM).
   *  Non-numeric printed stats (*, X, null) are stored as 0. */
  power?: number;
  toughness?: number;
  manaValue?: number;
}

export type Verb =
  | "enters"
  | "enters-graveyard"
  | "dies"
  | "leaves"
  | "cast"
  | "attacks"
  | "taps"
  | "non-combat-damage"
  | "combat-damage"
  | "draw"
  | "discard"
  | "mill"
  | "gain-life"
  | "lose-life"
  | "sacrifice"
  | "create-token"
  | "counter-added"
  | "land-play"
  | "untaps"
  | "proliferate"
  | "upkeep"
  | "begin-combat"
  | "end-step";

export const VERB_VOCAB: readonly Verb[] = [
  "enters",
  "enters-graveyard",
  "dies",
  "leaves",
  "cast",
  "attacks",
  "taps",
  "non-combat-damage",
  "combat-damage",
  "draw",
  "discard",
  "mill",
  "gain-life",
  "lose-life",
  "sacrifice",
  "create-token",
  "counter-added",
  "land-play",
  "untaps",
  "proliferate",
  // Phase/step triggers. Without these the vocabulary had nowhere to put "at the beginning of your
  // upkeep", so those abilities were tagged with the nearest available verb — a 46-card audit found
  // Nut Collector, Sen Triplets and Crystalline Giant all recorded as `enters`, which does not just
  // lose the timing, it forms FALSE edges with every ETB payoff in the deck. Nothing ever EMITS
  // these (no card supplies your upkeep), so they correctly form no edges; their value is that the
  // ability's own emits survive with honest timing, and a phase trigger marks a repeatable engine.
  "upkeep",
  "begin-combat",
  "end-step",
];

/** Common near-miss verb spellings the LLM emits, mapped to the canonical VERB_VOCAB member. */
export const VERB_ALIASES: Readonly<Record<string, Verb>> = {
  die: "dies",
  dying: "dies",
  death: "dies",
  enter: "enters",
  "enters-the-battlefield": "enters",
  etb: "enters",
  attack: "attacks",
  tap: "taps",
  "add-counter": "counter-added",
  "counter-add": "counter-added",
  "beginning-of-upkeep": "upkeep",
  "your-upkeep": "upkeep",
  "upkeep-step": "upkeep",
  "beginning-of-combat": "begin-combat",
  "combat-begins": "begin-combat",
  "beginning-of-end-step": "end-step",
  "end-of-turn": "end-step",
  "play-land": "land-play",
  "create-tokens": "create-token",
  untap: "untaps",
  untapped: "untaps",
};

/** An event an ability puts out for OTHER cards to trigger on. Subject is concrete. */
export interface GameEvent {
  verb: Verb;
  subject: SubjectFilter;
  /** Marks an event `impliedEvents` synthesized (e.g. "any creature can attack"), rather than one
   *  the tagger authored from oracle text. Never set by the LLM/extraction pipeline -- matcher-only,
   *  written solely by `packages/matcher/src/implied.ts`. Used to scope `combatSelfSupplied` to
   *  implied combat only, so authored combat emits (goad, Mage Slayer, Saskia) still form edges. */
  implied?: true;
}

/** The closed set of recognized effect.kind labels. Extraction output is normalized to this
 *  set (via EFFECT_ALIASES); abilities whose kind is unknown after aliasing are dropped, since
 *  they are almost always a keyword the model mistook for an ability (e.g. "trample") or the
 *  emit-verb name pasted into effect.kind (e.g. "counter-added"). */
export const EFFECT_KINDS = [
  "token-generation",
  "damage",
  "player-life-loss",
  "lifegain",
  "drain",
  "draw-card",
  "forced-sacrifice",
  "pump",
  "cost-reduction",
  "trigger-doubling",
  "graveyard-recursion",
  "clone",
  "token-doubling",
  "damage-multiplier",
  "tax",
  "top-manipulation",
  "counter-placement",
  "enters-with-counters",
  "mana-generation",
  "fast-mana",
  "ritual",
  "copy-spell",
  "speed-increase",
  "flicker",
  "animate",
  "untap",
  "proliferate",
  "graveyard-hate",
  "extra-combat",
] as const;

export type EffectKind = (typeof EFFECT_KINDS)[number];

/** Common near-miss labels the LLM emits, mapped to the canonical EFFECT_KINDS member. These
 *  mirror the label merges baked into the gold set, so model output lands on the same target. */
export const EFFECT_ALIASES: Readonly<Record<string, EffectKind>> = {
  "counter-added": "counter-placement",
  "counter-placed": "counter-placement",
  "player-damage": "damage",
  "noncombat-damage": "damage",
  "non-combat-damage": "damage",
  "life-loss": "player-life-loss",
  lord: "pump",
  anthem: "pump",
  scry: "top-manipulation",
  surveil: "top-manipulation",
  blink: "flicker",
  flickering: "flicker",
  "exile-and-return": "flicker",
};

/** The closed set of recognized effect.scaling bases — how a payoff's amount scales. Extraction
 *  output is normalized to this set (via SCALING_ALIASES); unknown → "fixed" (no scaling). */
export const SCALING_BASES = [
  "fixed",
  "per-creature",
  "per-permanent",
  "per-graveyard",
  "per-cast-or-spell",
  "x-cost",
  "per-opponent",
  "unbounded",
] as const;

export type ScalingBasis = (typeof SCALING_BASES)[number];

/** Near-miss scaling labels the LLM emits, mapped to a canonical SCALING_BASES member. */
export const SCALING_ALIASES: Readonly<Record<string, ScalingBasis>> = {
  "for-each-creature": "per-creature",
  "per-creature-you-control": "per-creature",
  "for-each-permanent": "per-permanent",
  "for-each-artifact": "per-permanent",
  devotion: "per-permanent",
  "per-graveyard-creature": "per-graveyard",
  "per-spell": "per-cast-or-spell",
  storm: "per-cast-or-spell",
  "for-each-opponent": "per-opponent",
  "per-player": "per-opponent",
  x: "x-cost",
  combo: "unbounded",
  infinite: "unbounded",
};

export interface Effect {
  /** Normalized to the closed EFFECT_KINDS set at validation time. */
  kind: string;
  subject?: SubjectFilter;
  /** Normalized to the closed SCALING_BASES set at validation time; absent → "fixed". */
  scaling?: string;
}

export type AbilityKind = "triggered" | "activated" | "static" | "on-cast";

export interface Ability {
  kind: AbilityKind;
  /** Present for triggered abilities. "enters or attacks" = one trigger, two verbs. */
  trigger?: { verbs: Verb[]; subject: SubjectFilter };
  /** Activated abilities: informational cost text, not parsed in Stage 1. */
  cost?: string;
  effect: Effect;
  /** Events this ability emits for others to trigger on. */
  emits?: GameEvent[];
}

export interface Characteristics {
  types: string[];
  subtypes: string[];
  colors: string[];
  identity: string[];
  cmc: number;
  power: string | null;
  toughness: string | null;
  /** Printed cards are always false. */
  token: boolean;
  keywords: string[];
}

export interface CardTags {
  oracleId: string;
  schemaVersion: number;
  promptVersion: number;
  model: string;
  characteristics: Characteristics;
  abilities: Ability[];
  /** True for a hand-verified tag that must survive automated re-tagging (e.g. a prompt-version
   *  bump). needsRetag short-circuits to false for a pinned tag regardless of version drift —
   *  set this only for cards where the LLM has demonstrably gotten the shape wrong and a human
   *  fixed it directly (see docs/superpowers/plans/2026-07-28-strategy-gap-fixes.md Task 2). */
  pinned?: boolean;
}
