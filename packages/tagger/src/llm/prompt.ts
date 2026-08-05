import type { Card } from "@mtg/engine";
import { EFFECT_KINDS, SCALING_BASES, VERB_VOCAB } from "../schema.js";
import type { ChatMessage } from "./provider.js";

export const PROMPT_VERSION = 24;

export { EFFECT_KINDS };
export { SCALING_BASES };

const INSTRUCTIONS = `You decompose a Magic: The Gathering card's rules text into structured abilities.
Return ONLY JSON of the form { "abilities": Ability[] }. Do not include characteristics.

An Ability is:
{
  "kind": "triggered" | "activated" | "static" | "on-cast",
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
  "zone"?: string,                     // subject's zone if not battlefield, e.g. "graveyard", "hand", "exile"
  "stats"?: StatPredicate[] }          // numeric conditions on the subject; ALL must hold

A StatPredicate is { "metric": "power"|"toughness"|"mana-value", "op": "lte"|"gte"|"lt"|"gt"|"eq",
"value"?: number, "vs"?: "power"|"toughness" }. Use "value" for a constant ("power 2 or less" ->
{metric:"power",op:"lte",value:2}); use "vs" for a stat-vs-stat comparison ("toughness greater
than its power" -> {metric:"toughness",op:"gt",vs:"power"}). Only add stats when the card states a
numeric power/toughness/mana-value condition; omit it otherwise.

An Event is { "verb": Verb, "subject": SubjectFilter } with a CONCRETE subject.

Verb must be one of: ${VERB_VOCAB.join(", ")}.
effect.kind should be one of: ${EFFECT_KINDS.join(", ")} (choose the closest; these are the recognized labels).
effect.scaling: how the effect's AMOUNT scales — one of: ${SCALING_BASES.join(", ")}.
Use "fixed" for a constant amount (draw a card, deal 1, make a token). Use per-creature /
per-permanent / per-graveyard / per-cast-or-spell / per-opponent when the amount is "equal to
the number of ..." those. Use x-cost when the amount is a variable X paid on cast/activation.
Use unbounded for combo/loop payoffs with no fixed ceiling. Default to "fixed" when unsure.
"top-manipulation" = looking at / reordering / putting cards on top of a library, or scry/surveil that stack the top (Brainstorm, Sensei's Divining Top). An ability with several effects becomes one ability per effect, sharing the trigger.
"pump" gives +X/+X or +X/+0 to creatures (static or triggered); the subject says who — a subtype for a tribe ("wizard"), type:"creature" for your whole team. Use it for anthems/lords too.
"damage" = dealing damage; subject.control says who ("opp" for "each opponent"/a player, "any" for "any target"). Do not split into player- vs noncombat- variants.
"drain" = one ability that BOTH drains life from a player AND you gain life (Blood Artist, Zulaport) — do not split it into two abilities.
"lifegain" = you gain life with NO life loss for anyone (Essence Warden, Soul Warden, Archangel of Thune, lifelink payoffs). Use this — not "drain" — when only you gain; it emits { verb: "gain-life" } so lifegain-matters payoffs (Sanguine Bond, Vito) can match.
"mana-generation" = break-even mana (Signets); "fast-mana" = a source that nets MORE mana than it cost (Sol Ring, Ancient Tomb, Mana Crypt); "ritual" = a one-shot spell adding more mana than it cost (Dark Ritual, Jeska's Will). For any mana effect, set subject.colors to the mana produced — WUBRG letters, or "C" for colorless (Sol Ring → ["C"]) — so mana-color payoffs (Forsaken Monument, Cabal Coffers) can match.
"flicker" = exile a permanent and return it to the battlefield (blink), e.g. Conjurer's Closet, Restoration Angel. The returned permanent RE-ENTERS, so the ability emits { verb: "enters" } with the flickered subject, feeding enter-the-battlefield payoffs.
"animate" = a noncreature permanent (usually a land or artifact) becomes a creature, e.g. man-lands (Mutavault, Celestial Colonnade), Ensoul Artifact. subject describes what is animated. No emit — becoming a creature is not entering.
"untap" = untapping a permanent (Seedborn Muse, Kiora's Follower, untap-lands combos). Emit { verb: "untaps" } with the untapped subject so untap-matters payoffs and untap/tap loops can match. A "whenever ~ becomes untapped" trigger uses verb "untaps".

RULES:
- kind: "triggered" is ONLY for "when/whenever/at" clauses. Continuous or replacement effects
  ("... instead", "as long as", "creatures you control get ...", anthems, doublers) are
  kind:"static". A "{cost}: {effect}" ability (including "{T}" or "Sacrifice ...") is
  kind:"activated".
- For a trigger about the card ITSELF ("When ~ enters", "When ~ dies"), leave the subject's
  type/subtype UNSET (just control:"you"); do NOT fill in the card's own printed types.
- TIMING TRIGGERS have their own verbs — never substitute "enters" or "attacks" for them:
  "at the beginning of your upkeep" -> verbs:["upkeep"];
  "at the beginning of combat on your turn" -> verbs:["begin-combat"];
  "at the beginning of your/the end step", "at end of turn" -> verbs:["end-step"].
  These fire on a PHASE, not on a permanent entering or attacking. Tagging Bitterblossom's or
  Nut Collector's upkeep trigger as "enters" makes it read as a one-shot enter-the-battlefield
  effect and wrongly links it to every ETB payoff in the deck. A phase trigger has
  subject { control: "you" } unless the card names someone else ("at the beginning of EACH
  upkeep" -> control:"any"). The ability's emits are unaffected — an upkeep token-maker still
  emits create-token AND enters, which is what token payoffs consume.
- Any other timing wording that is not one of those three, and not a real game event ("when this
  is turned face up", "when you cycle this card"), is still kind:"triggered"; pick the closest
  verb only if it genuinely describes the event, otherwise model just the effect and emits.
- Ignore evergreen keywords (flying, trample, vigilance, haste, first strike, indestructible,
  ward, "can't block"), reminder text in (parentheses), and mana costs. Tag ONLY abilities with
  a synergy-relevant effect; a card whose only text is keywords/vanilla has abilities: [].
- Never output duplicate abilities.
- kind:"on-cast" is an ability that fires on casting THIS card: an instant or sorcery's own
  resolution effect ("Each opponent mills eight cards"), or a permanent's "When you cast this
  spell, ..." (the big Eldrazi). It carries effect + emits and has NO trigger. It is a PRODUCER
  only. Distinguish it from "Whenever you cast a spell / an instant or sorcery ..." (a GENERAL
  cast-trigger about OTHER spells you cast → kind:"triggered", verbs:["cast"]) and from "When
  this enters ..." (→ kind:"triggered", verbs:["enters"]). An ability the spell GRANTS to a
  permanent keeps its own kind on the granted subject. Lands are played, not cast → never on-cast.
- Direct reanimation / graveyard-recursion effects follow the SAME on-cast/static split as
  everything else — don't invent a fake trigger for them. A spell's own "put target creature
  card from a graveyard onto the battlefield" is its on-cast effect (kind:"on-cast", NO
  trigger); model the graveyard card being pulled as effect.subject with zone:"graveyard" (not
  as a trigger.subject). A permanent's standing "you may cast/play a card from your graveyard"
  is a kind:"static" permission (again NO trigger — nothing triggers a standing permission);
  same effect.subject.zone:"graveyard" convention. Reserve trigger.verbs:["cast"] + a
  graveyard-zoned subject for the rare case of a genuine payoff that reacts to OTHER cards
  being cast from a graveyard.

INVARIANT — emits:
- A "cast" ability emits BOTH { verb: "cast" } and { verb: "enters" }.
- Every other way a permanent enters (token, reanimation, blink/flicker) emits { verb: "enters" } ONLY.
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
- Effects whose verb no trigger consumes (pumps, cost reduction, taxes) need no emits.
- NEVER emit an event the card does not actually cause. An emit is consumed by other cards as if
  it really happened, so a wrong one invents synergy that does not exist. Three that recur:
  * WHERE the card goes decides "enters". Searching a library and putting a card into your HAND
    (tutors, "search your library for a land card ... put it into your hand") emits NOTHING —
    no permanent entered. Only "put it onto the battlefield" (Cultivate's second land, fetchlands,
    Nature's Lore) emits { verb: "enters" }. Kura, the Boundless Sky searches lands to HAND and
    must not emit "enters"; a fetchland must.
  * DESTROYING or EXILING a permanent is not sacrificing it. "Destroy target creature", "exile
    target permanent", a board wipe — these emit "dies" for a destroyed CREATURE and nothing else.
    Emit "sacrifice" ONLY when the card says sacrifice, because sacrifice-matters payoffs
    (aristocrats) trigger on it and a destroy effect never triggers them.
  * "counter-added" is for counters a counter-matters payoff cares about — +1/+1, -1/-1, charge,
    and the like — with subject.counter set. Loyalty counters on a planeswalker, rad counters, and
    a Class's level counters are NOT those: set subject.counter to the actual counter name, and if
    the card is only putting loyalty on a planeswalker, emit nothing.
- Proliferate: a card that proliferates is a SOURCE — use effect.kind "proliferate" and emit { "verb": "proliferate", "subject": { "control": "you", "token": null } }; do NOT emit counter-added for it. A card that cares about proliferating (e.g. "if you would proliferate, proliferate twice", "whenever you proliferate ...") is a PAYOFF — give it a trigger { "verbs": ["proliferate"], "subject": { "control": "you", "token": null } } and its own effect.`;

/** One card presented to the model as the user turn. */
function cardTurn(name: string, typeLine: string, text: string): string {
  return `Card: ${name} — ${typeLine}\nText: "${text}"`;
}

/** Few-shot examples as real chat turns — models follow example turns better than an inlined blob. */
const FEW_SHOT_TURNS: ChatMessage[] = [
  {
    role: "user",
    content: cardTurn(
      "Inalla, Archmage Ritualist",
      "Legendary Creature — Human Wizard",
      "Eminence — Whenever another nontoken Wizard you control enters, if Inalla is in the command zone or on the battlefield, you may pay {1}. If you do, create a token that's a copy of that Wizard. The token gains haste. Exile it at the beginning of the next end step.\nTap five untapped Wizards you control: Target player loses 7 life.",
    ),
  },
  {
    role: "assistant",
    content: `{ "abilities": [
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
] }`,
  },
  {
    role: "user",
    content: cardTurn(
      "Kindred Discovery",
      "Enchantment",
      "As this enchantment enters, choose a creature type. Whenever a creature you control of the chosen type enters or attacks, draw a card.",
    ),
  },
  {
    role: "assistant",
    content: `{ "abilities": [
  { "kind": "triggered",
    "trigger": { "verbs": ["enters", "attacks"], "subject": { "type": "creature", "control": "you", "token": null, "chosenType": true } },
    "effect": { "kind": "draw-card" },
    "emits": [ { "verb": "draw", "subject": { "control": "you", "token": null } } ] }
] }`,
  },
  {
    role: "user",
    content: cardTurn(
      "Restoration Angel",
      "Creature — Angel",
      "Flash, flying. When Restoration Angel enters, you may exile target non-Angel creature you control, then return that card to the battlefield under your control.",
    ),
  },
  {
    role: "assistant",
    content: `{ "abilities": [
  { "kind": "triggered",
    "trigger": { "verbs": ["enters"], "subject": { "control": "you", "token": null } },
    "effect": { "kind": "flicker", "subject": { "type": "creature", "control": "you", "token": null } },
    "emits": [ { "verb": "enters", "subject": { "type": "creature", "control": "you", "token": null } } ] }
] }`,
  },
  {
    role: "user",
    content: cardTurn(
      "Kiora's Follower",
      "Creature — Merfolk",
      "{T}: Untap another target permanent.",
    ),
  },
  {
    role: "assistant",
    content: `{ "abilities": [
  { "kind": "activated",
    "cost": "{T}",
    "effect": { "kind": "untap", "subject": { "type": "permanent", "control": "you", "token": null } },
    "emits": [ { "verb": "untaps", "subject": { "type": "permanent", "control": "you", "token": null } } ] }
] }`,
  },
  {
    role: "user",
    content: cardTurn(
      "Celestial Colonnade",
      "Land",
      "{3}{W}{U}: Until end of turn, Celestial Colonnade becomes a 4/4 white and blue Elemental creature with flying and vigilance. It's still a land.",
    ),
  },
  {
    role: "assistant",
    content: `{ "abilities": [
  { "kind": "activated",
    "cost": "{3}{W}{U}",
    "effect": { "kind": "animate", "subject": { "type": "land", "control": "you", "token": null } } }
] }`,
  },
  {
    role: "user",
    content: cardTurn(
      "Kozilek, Butcher of Truth",
      "Legendary Creature — Eldrazi",
      "When you cast this spell, draw four cards.\nAnnihilator 4 (Whenever this creature attacks, defending player sacrifices four permanents of their choice.)\nWhen Kozilek is put into a graveyard from anywhere, its owner shuffles their graveyard into their library.",
    ),
  },
  {
    role: "assistant",
    content: `{ "abilities": [
  { "kind": "on-cast",
    "effect": { "kind": "draw-card", "subject": { "control": "you", "token": null } },
    "emits": [ { "verb": "draw", "subject": { "control": "you", "token": null } } ] }
] }`,
  },
  {
    role: "user",
    content: cardTurn(
      "Maddening Cacophony",
      "Sorcery",
      "Kicker {3}{U}\nEach opponent mills eight cards. If this spell was kicked, instead each opponent mills half their library, rounded up.",
    ),
  },
  {
    role: "assistant",
    content: `{ "abilities": [
  { "kind": "on-cast",
    "effect": { "kind": "top-manipulation", "subject": { "control": "opp", "token": null }, "scaling": "fixed" },
    "emits": [ { "verb": "mill", "subject": { "control": "opp", "token": null } } ] }
] }`,
  },
  {
    role: "user",
    content: cardTurn(
      "Karn's Bastion",
      "Land",
      "{T}: Add {C}.\n{4}, {T}: Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)",
    ),
  },
  {
    role: "assistant",
    content: `{ "abilities": [
  { "kind": "activated", "cost": "{T}", "effect": { "kind": "mana-generation", "subject": { "control": "you", "token": null, "colors": ["C"] } }, "emits": [] },
  { "kind": "activated", "cost": "{4}, {T}", "effect": { "kind": "proliferate" }, "emits": [ { "verb": "proliferate", "subject": { "control": "you", "token": null } } ] }
] }`,
  },
  {
    role: "user",
    content: cardTurn(
      "Tekuthal, Inquiry Dominus",
      "Legendary Creature — Phyrexian Horror",
      "Flying\nIf you would proliferate, proliferate twice instead.\n{1}{U/P}{U/P}, Remove three counters from among other artifacts, creatures, and planeswalkers you control: Put an indestructible counter on Tekuthal. ({U/P} can be paid with either {U} or 2 life.)",
    ),
  },
  {
    role: "assistant",
    content: `{ "abilities": [
  { "kind": "triggered", "trigger": { "verbs": ["proliferate"], "subject": { "control": "you", "token": null } }, "effect": { "kind": "trigger-doubling" }, "emits": [] },
  { "kind": "activated", "cost": "{1}{U/P}{U/P}, Remove three counters from among other artifacts, creatures, and planeswalkers you control", "effect": { "kind": "counter-placement", "subject": { "control": "you", "token": null, "counter": "indestructible" } }, "emits": [ { "verb": "counter-added", "subject": { "control": "you", "token": null, "counter": "indestructible" } } ] }
] }`,
  },
  {
    role: "user",
    content: cardTurn(
      "Welcoming Vampire",
      "Creature — Vampire",
      "Flying\nWhenever another creature you control with power 2 or less enters, you may draw a card. If you do, discard a card. This ability triggers only once each turn.",
    ),
  },
  {
    role: "assistant",
    content: `{ "abilities": [
  { "kind": "triggered",
    "trigger": { "verbs": ["enters"], "subject": { "type": "creature", "control": "you", "token": null, "stats": [ { "metric": "power", "op": "lte", "value": 2 } ] } },
    "effect": { "kind": "draw-card" },
    "emits": [ { "verb": "draw", "subject": { "control": "you", "token": null } } ] }
] }`,
  },
  {
    role: "user",
    content: cardTurn("Grizzly Bears", "Creature — Bear", "3/3 vanilla creature, no rules text."),
  },
  { role: "assistant", content: `{ "abilities": [] }` },
];

export function buildAbilityMessages(card: Card): ChatMessage[] {
  return [
    { role: "system", content: INSTRUCTIONS },
    ...FEW_SHOT_TURNS,
    { role: "user", content: cardTurn(card.name, card.typeLine, card.oracleText) },
  ];
}
