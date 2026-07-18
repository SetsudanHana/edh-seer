export const SCHEMA_VERSION = 1;

export type Control = "you" | "opp" | "any";

/** A characteristic filter: what a trigger cares about, or what an effect targets/produces. */
export interface SubjectFilter {
  type?: string;
  subtype?: string;
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

/** An event an ability puts out for OTHER cards to trigger on. Subject is concrete. */
export interface GameEvent {
  verb: Verb;
  subject: SubjectFilter;
}

export interface Effect {
  /** Open label set (e.g. "token-generation", "draw-card", "player-damage"). */
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
