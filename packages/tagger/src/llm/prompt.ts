import type { Card } from "@mtg/engine";
import { VERB_VOCAB } from "../schema.js";

export const PROMPT_VERSION = 17;

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
{ "type"?: string | string[],        // array = OR, e.g. ["instant","sorcery"]
  "subtype"?: string | string[],     // array = OR, e.g. ["faerie","wizard"]
  "colors"?: string[],
  "control": "you" | "opp" | "any",
  "token": true | false | null,        // true=token only, false=nontoken only, null=any
  "chosenType"?: true,                 // only for "the chosen type" wording
  "counter"?: string,                  // counter kind for counter-added events, e.g. "+1/+1"
  "zone"?: string }                    // subject's zone if not battlefield, e.g. "graveyard", "hand", "exile"

An Event is { "verb": Verb, "subject": SubjectFilter } with a CONCRETE subject.

Verb must be one of: ${VERB_VOCAB.join(", ")}.
effect.kind should be one of: ${EFFECT_KINDS.join(", ")} (choose the closest; these are the recognized labels).
"top-manipulation" = looking at / reordering / putting cards on top of a library, or scry/surveil that stack the top (Brainstorm, Sensei's Divining Top). An ability with several effects becomes one ability per effect, sharing the trigger.
"pump" gives +X/+X or +X/+0 to creatures (static or triggered); the subject says who — a subtype for a tribe ("wizard"), type:"creature" for your whole team. Use it for anthems/lords too.
"damage" = dealing damage; subject.control says who ("opp" for "each opponent"/a player, "any" for "any target"). Do not split into player- vs noncombat- variants.
"drain" = one ability that BOTH drains life from a player AND you gain life (Blood Artist, Zulaport) — do not split it into two abilities.
"mana-generation" = break-even mana (Signets); "fast-mana" = a source that nets MORE mana than it cost (Sol Ring, Ancient Tomb, Mana Crypt); "ritual" = a one-shot spell adding more mana than it cost (Dark Ritual, Jeska's Will). For any mana effect, set subject.colors to the mana produced — WUBRG letters, or "C" for colorless (Sol Ring → ["C"]) — so mana-color payoffs (Forsaken Monument, Cabal Coffers) can match.

RULES:
- kind: "triggered" is ONLY for "when/whenever/at" clauses. Continuous or replacement effects
  ("... instead", "as long as", "creatures you control get ...", anthems, doublers) are
  kind:"static". A "{cost}: {effect}" ability (including "{T}" or "Sacrifice ...") is
  kind:"activated".
- For a trigger about the card ITSELF ("When ~ enters", "When ~ dies"), leave the subject's
  type/subtype UNSET (just control:"you"); do NOT fill in the card's own printed types.
- Ignore evergreen keywords (flying, trample, vigilance, haste, first strike, indestructible,
  ward, "can't block"), reminder text in (parentheses), and mana costs. Tag ONLY abilities with
  a synergy-relevant effect; a card whose only text is keywords/vanilla has abilities: [].
- Never output duplicate abilities.

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
- Landfall ("whenever a land you control enters") is verb "enters" with subject
  { type: "land" } — it fires on lands played, fetched, or put onto the battlefield by
  ramp. Use "land-play" only for the narrower "whenever you play a land" land-drop action.
- A modal trigger ("choose one — ...") becomes one ability per mode, all sharing the
  same trigger.
- A "cast" trigger's subject captures the SPELL category cast: use the card type
  ("creature", "artifact", "enchantment", "instant", "sorcery", "planeswalker"), an ARRAY
  for OR (instant or sorcery → type: ["instant","sorcery"]), "noncreature", or a subtype
  (e.g. "zombie" for a "Zombie spell"). Omit type for "a spell" (any).
- An effect that lets you cast a card ("you may cast it", cascade, impulse-cast) emits
  { verb: "cast" } with the cast card's subject. A permanent cast this way also emits
  "enters"; an instant/sorcery cast does not (it never enters the battlefield).
- An effect emits the event for its action so payoffs can consume it: dealing damage →
  { verb: "non-combat-damage" } (or "combat-damage" for combat damage); a player losing
  life → { verb: "lose-life" }; gaining life → { verb: "gain-life" }; drawing → { verb:
  "draw" }; milling → { verb: "mill" }; discarding → { verb: "discard" }. The event's
  subject carries the affected player's control (you/opp/any). Damage dealt to a PLAYER
  also emits { verb: "lose-life" } (damage is life loss); damage to "any target" does not.
- "speed-increase" is the "Start your engines!" speed mechanic; its speed rises when an
  opponent loses life, so model it as a trigger on { verb: "lose-life", control: "opp" }.
- Effects whose verb no trigger consumes (pumps, cost reduction, taxes) need no emits.`;

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
    "effect": { "kind": "player-life-loss", "subject": { "control": "opp", "token": null } },
    "emits": [ { "verb": "lose-life", "subject": { "control": "opp", "token": null } } ] }
] }

EXAMPLE 2
Card: Kindred Discovery — Enchantment
Text: "As this enchantment enters, choose a creature type. Whenever a creature you control of the chosen type enters or attacks, draw a card."
Output:
{ "abilities": [
  { "kind": "triggered",
    "trigger": { "verbs": ["enters", "attacks"], "subject": { "type": "creature", "control": "you", "token": null, "chosenType": true } },
    "effect": { "kind": "draw-card" },
    "emits": [ { "verb": "draw", "subject": { "control": "you", "token": null } } ] }
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
