import type { Card } from "@mtg/engine";
import { VERB_VOCAB } from "../schema.js";

export const PROMPT_VERSION = 6;

export const EFFECT_KINDS = [
  "token-generation",
  "player-damage",
  "player-life-loss",
  "noncombat-damage",
  "drain",
  "draw-card",
  "forced-sacrifice",
  "pump-tribe",
  "lord",
  "cost-reduction",
  "trigger-doubling",
  "graveyard-recursion",
  "clone",
  "token-doubling",
  "damage-multiplier",
  "tax",
  "scry",
  "counter-placement",
  "enters-with-counters",
  "mana-generation",
  "copy-spell",
] as const;

const INSTRUCTIONS = `You decompose a Magic: The Gathering card's rules text into structured abilities.
Return ONLY JSON of the form { "abilities": Ability[] }. Do not include characteristics.

An Ability is:
{
  "kind": "triggered" | "activated" | "static",
  "trigger": { "verbs": Verb[], "subject": SubjectFilter },   // triggered only
  "cost": string,                                             // activated only; copy the cost text
  "effect": { "kind": string, "subject"?: SubjectFilter },
  "emits": Event[]                                            // events this ability puts out for OTHER cards
}

A SubjectFilter is:
{ "type"?: string, "subtype"?: string, "colors"?: string[],
  "control": "you" | "opp" | "any",
  "token": true | false | null,        // true=token only, false=nontoken only, null=any
  "chosenType"?: true,                 // only for "the chosen type" wording
  "counter"?: string,                  // counter kind for counter-added events, e.g. "+1/+1"
  "zone"?: string }                    // subject's zone if not battlefield, e.g. "graveyard", "hand", "exile"

An Event is { "verb": Verb, "subject": SubjectFilter } with a CONCRETE subject.

Verb must be one of: ${VERB_VOCAB.join(", ")}.
effect.kind should be one of: ${EFFECT_KINDS.join(", ")} (choose the closest; these are the recognized labels).

INVARIANT — emits:
- A "cast" ability emits BOTH { verb: "cast" } and { verb: "enters" }.
- Every other way a permanent enters (token, reanimation, blink) emits { verb: "enters" } ONLY.
- A token-maker emits { verb: "create-token", subject: {...token:true} } AND
  { verb: "enters", subject: {...token:true} } so downstream payoffs see the token entering.
  Include the token's subtype when it has one (e.g. subtype "treasure", "food", "clue",
  "blood", "aura", "role"), since payoffs care about specific token subtypes.
- A "Sacrifice a creature" cost or effect emits { verb: "sacrifice" } AND { verb: "dies" }
  (a sacrificed creature dies), both with the sacrificed creature's subject. Sacrificing a
  NONcreature (e.g. a Treasure/artifact) emits { verb: "sacrifice" } ONLY.
- An effect that puts a counter on a permanent emits { verb: "counter-added" } with the
  recipient's subject and subject.counter set to the counter kind (e.g. "+1/+1").
- A static ability whose condition or magnitude reads cards in a zone ("for each Zombie
  card in your graveyard") sets subject.zone to that zone (e.g. "graveyard").
- Effects whose verb no trigger consumes need no emits.`;

const FEW_SHOT = `EXAMPLE 1
Card: Inalla, Archmage Ritualist — Legendary Creature — Human Wizard
Text: "Eminence — Whenever another nontoken Wizard you control enters, if Inalla is in the command zone or on the battlefield, you may pay {1}. If you do, create a token that's a copy of that Wizard. The token gains haste. Exile it at the beginning of the next end step.\nTap five untapped Wizards you control: Target player loses 7 life."
Output:
{ "abilities": [
  { "kind": "triggered",
    "trigger": { "verbs": ["enters"], "subject": { "subtype": "wizard", "control": "you", "token": false } },
    "effect": { "kind": "token-generation", "subject": { "subtype": "wizard", "control": "you", "token": true } },
    "emits": [
      { "verb": "create-token", "subject": { "subtype": "wizard", "control": "you", "token": true } },
      { "verb": "enters", "subject": { "subtype": "wizard", "control": "you", "token": true } }
    ] },
  { "kind": "activated",
    "cost": "Tap five untapped Wizards you control",
    "effect": { "kind": "player-life-loss", "subject": { "control": "opp", "token": null } } }
] }

EXAMPLE 2
Card: Kindred Discovery — Enchantment
Text: "As this enchantment enters, choose a creature type. Whenever a creature you control of the chosen type enters or attacks, draw a card."
Output:
{ "abilities": [
  { "kind": "triggered",
    "trigger": { "verbs": ["enters", "attacks"], "subject": { "type": "creature", "control": "you", "token": null, "chosenType": true } },
    "effect": { "kind": "draw-card" } }
] }

EXAMPLE 3
Card: Grizzly Bears — Creature — Bear (vanilla)
Output: { "abilities": [] }`;

export function buildAbilityPrompt(card: Card): string {
  return `${INSTRUCTIONS}

${FEW_SHOT}

NOW DECOMPOSE
Card: ${card.name} — ${card.typeLine}
Text: "${card.oracleText}"
Output:`;
}
