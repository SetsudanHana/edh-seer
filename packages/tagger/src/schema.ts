export const SCHEMA_VERSION = 1;

export type Control = "you" | "opp" | "any";

/** A characteristic filter: what a trigger cares about, or what an effect targets/produces. */
export interface SubjectFilter {
  /** A card type, or an array of types meaning OR (e.g. ["instant","sorcery"]). */
  type?: string | string[];
  /** A subtype, or an array meaning OR (e.g. ["faerie","wizard"]). */
  subtype?: string | string[];
  colors?: string[];
  control: Control;
  /** false = nontoken only, true = token only, null = any. */
  token: boolean | null;
  /** Marks "the chosen type" (Kindred Discovery); resolved deck-aware in Stage 2. */
  chosenType?: boolean;
  /** Counter kind for `counter-added` events, e.g. "+1/+1", "-1/-1", "loyalty". */
  counter?: string;
  /** Zone the subject lives in; omitted means battlefield. E.g. "graveyard", "hand", "exile". */
  zone?: string;
}

export type Verb =
  | "enters"
  | "enters-graveyard"
  | "dies"
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
  | "land-play";

export const VERB_VOCAB: readonly Verb[] = [
  "enters",
  "enters-graveyard",
  "dies",
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
  "play-land": "land-play",
  "create-tokens": "create-token",
};

/** An event an ability puts out for OTHER cards to trigger on. Subject is concrete. */
export interface GameEvent {
  verb: Verb;
  subject: SubjectFilter;
}

/** The closed set of recognized effect.kind labels. Extraction output is normalized to this
 *  set (via EFFECT_ALIASES); abilities whose kind is unknown after aliasing are dropped, since
 *  they are almost always a keyword the model mistook for an ability (e.g. "trample") or the
 *  emit-verb name pasted into effect.kind (e.g. "counter-added"). */
export const EFFECT_KINDS = [
  "token-generation",
  "damage",
  "player-life-loss",
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
};

export interface Effect {
  /** Normalized to the closed EFFECT_KINDS set at validation time. */
  kind: string;
  subject?: SubjectFilter;
}

export type AbilityKind = "triggered" | "activated" | "static";

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
}
