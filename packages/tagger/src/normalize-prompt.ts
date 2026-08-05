import type { Clause } from "./segment.js";

/** Bump when ANYTHING that determines the request changes: SYSTEM, VERBS, TRIGGERS, ZONES — and
 *  `segment.ts`, because the segmenter decides which clauses exist and what ids they carry.
 *
 *  That last one is not obvious and is easy to get wrong: `segmentHash` covers the card's INPUTS
 *  (oracle text, type line, keywords), not the segmenter's behaviour. So a segmenter change alters
 *  the clause list while the hash stays identical, and without a version bump every persisted doc
 *  would look fresh forever and never re-queue. Multi-face handling changed exactly that way.
 *
 *  This version IDENTIFIES the prompt. It no longer decides what is stale — see
 *  NORMALIZE_MIN_COMPATIBLE — so bumping it alone is free, and every persisted doc still records
 *  exactly which prompt produced it. */
export const NORMALIZE_VERSION = 6;

/** The oldest prompt whose answers are still valid. `needsNormalize` re-queues a card only when its
 *  stored version is BELOW this, so a mixed-version corpus is a stated condition rather than an
 *  accident.
 *
 *  Raise this ONLY for a BREAKING change — prompt prose, a changed rule, a segmenter change that
 *  moves clause ids — because raising it re-buys the whole corpus (~$8.50 at 2,453 cards). An
 *  ADDITIVE change (a new verb, a new trigger member) leaves it alone: a new verb only widens what
 *  the model MAY say, so an answer given without the option is still correct. Pick up the addition
 *  cheaply with `normalize-corpus.ts --refresh-other` instead of re-buying everything.
 *
 *  3 is the version the calibration corpus was bought at. */
export const NORMALIZE_MIN_COMPATIBLE = 3;

export const VERBS = ["destroy", "exile", "sacrifice", "tap", "untap", "draw", "discard", "mill", "search",
  "put", "return", "create", "counter-spell", "copy", "gain-life", "lose-life", "deal-damage",
  "add-mana", "add-counter", "remove-counter", "grant-ability", "modify-pt", "prevent", "cast",
  "play", "shuffle", "reveal", "attach", "transform", "trigger-again", "extra-turn", "extra-combat",
  "animate", "cant", "emblem", "fight", "set-life", "proliferate", "scry", "surveil", "cost-modify",
  "other", "none"];
export const ZONES = ["battlefield", "graveyard", "hand", "library", "exile", "stack", "command"];
export const TRIGGERS = ["enters", "dies", "leaves", "attacks", "blocks", "taps", "untaps", "cast",
  "upkeep", "begin-combat", "end-step", "draw", "draw-step", "main-phase", "combat-damage-step", "damage-dealt", "life-gained", "life-lost",
  "counter-added", "sacrificed", "discarded", "milled", "turned-face-up", "level-up", "chapter",
  "proliferate",
  // Named because the corpus named them: an opponent searching (Archivist of Oghma), becoming a
  // target (Unsettled Mariner), scry or surveil (Matoya), a Room unlocking (Mirror Room). None has
  // an engine verb, so they form no edges and surface in `unknownTriggers` — the point is that one
  // unnameable clause no longer throws away the whole card.
  "search", "becomes-target", "scry", "surveil", "unlocked",
  // The same escape hatch VERBS has always had. Its absence was pure asymmetry: the model, told to
  // pick EXACTLY one member, invented "other" anyway on 9 cards and lost all of them.
  "other",
  "none"];

export const SYSTEM = `You NORMALIZE Magic: The Gathering rules text. You do not classify, rate, or interpret it.

You are given a card's clauses, already numbered. Answer EVERY clause id exactly once, in order.
Never merge clauses, never split one, never invent an id — with one stated exception, a clause
marked twoConditions, described in the rules below.

The clause list already carries type= and cost= where they apply. Do NOT re-decide them; copy
type= into abilityType verbatim.

For each clause return:
{ "id": number,
  "abilityType": copied from type=, or "none" for keyword/reminder clauses,
  "trigger": { "event": TriggerEvent, "subject": string, "control": "you"|"opponent"|"any" },  // omit if not triggered
  "actions": [ { "verb": Verb, "object": string, "fromZone": Zone|null, "toZone": Zone|null,
                 "amount": string|null, "optional": boolean } ] }

Verb is EXACTLY one of: ${VERBS.join(", ")}
Zone is EXACTLY one of: ${ZONES.join(", ")}
TriggerEvent is EXACTLY one of: ${TRIGGERS.filter((t) => t !== "none").join(", ")}

Rules:
- Record what the clause SAYS. "Destroy target creature" is verb "destroy" — never a category
  like "removal" and never a strategic label.
- fromZone/toZone are set ONLY when the clause MOVES an object between zones. Getting this right
  matters more than anything else: "search your library ... put it onto the battlefield" is
  library->battlefield, but "... put it into your hand" is library->hand. They are different cards.
- Every clause you are shown states a game action; inert clauses are not sent to you.
- OMIT the trigger field entirely when the clause is not triggered. Do not send trigger:null and
  do not send event:"none" — one fact must have exactly one encoding, or two runs disagree over
  nothing. (This ambiguity alone accounted for every residual disagreement in the first run.)
- "trigger-again" is for effects that make a triggered ability trigger an additional time.
- COSTS are already decided for you. A clause showing costActions=[...] contributes exactly those
  actions FIRST, verbatim, then the actions of its effect. A clause with a cost= but no
  costActions contributes none from the cost — paying mana and tapping the source are not things
  any card triggers on. Never infer a cost action yourself.
- ZONES. Set fromZone/toZone for EXACTLY these five verbs and no others: put, return, exile,
  search, cast. Their zones genuinely vary — "put onto the battlefield" and "put into your hand"
  are different cards. Every other verb already fixes its own zones: a draw is always
  library->hand, a mill always library->graveyard, a discard always hand->graveyard, a sacrifice
  always battlefield->graveyard. Recording those makes two runs disagree over a fact neither
  chose. Leave them null.
  Those verbs already imply where they happen; recording it twice makes two runs disagree over
  nothing. "create" is the one exception you may be tempted by — a token entering is implied by
  the verb, so leave its zones null.
- "Enters tapped" is a property of entering, not an action: record it as verb "tap" with object
  "this", so the fact survives without inventing a second entry event.
- List one action per game action the clause states, in the order written.
- "cant" is for restrictions ("can't attack", "can't be countered"); put the restriction in object.
- "animate" is a permanent BECOMING a creature ("becomes a 0/0 Elemental creature", man-lands,
  Ensoul Artifact). Do not reach for transform, modify-pt or grant-ability for this — transform is
  only for a double-faced card turning over.
- "put a counter on" is ALWAYS add-counter, never put. The verb "put" is exclusively for moving an
  object between zones ("put it onto the battlefield", "put it into your hand").
- Three pairs that have been observed swapping; the rule for each:
  * A COUNTER of any kind (+1/+1, loyalty, lore, indestructible, stun) is always add-counter with
    the kind in object — never "other", even for an unusual counter.
  * "becomes a creature" is animate. "transform" is ONLY a double-faced card turning over.
  * An effect that makes an ability trigger an extra time is trigger-again; an effect that makes a
    TOKEN is create. Copying a permanent is copy. These are three different things.
- EFFECT ACTIONS are already decided for you too. A clause showing effectActions=[...] states
  those actions; include every one of them, then add any other action the clause states. They were
  read off the text mechanically, so do not drop one, rename one, or replace one with "other".
  An entry written verb=N carries the amount: copy N into that action's "amount" field.
- "emblem" is getting an emblem. It is NOT "create" — create is for tokens, and an emblem is
  neither a permanent nor a card. The ability the emblem grants is a separate clause of its own.
- "fight" is two creatures dealing damage equal to their power to each other.
- "set-life" is a life total being SET to a number ("target opponent's life total becomes 10").
  It is not lose-life or gain-life: how much changes depends on the total it started from.
- A clause marked twoConditions fires on TWO different events ("When this enters OR is put into a
  graveyard", "When this enters AND whenever you fully unlock a Room"). One record holds one
  trigger, so answer that clause with TWO records: the first keeps the clause's id, the second takes
  the next unused id, and both repeat the same actions. Only a clause marked twoConditions may be
  answered this way, and only with one extra record.
- A TriggerEvent of "other" is the same escape hatch for a trigger no event above names ("whenever
  you choose a Ring-bearer"): use it and put the event verbatim in the trigger's subject. Never
  force a near-miss event — a wrong event forms false edges with every payoff for the real one.
- "other" is the deliberate escape hatch: when a clause does something no verb above covers
  (changing maximum hand size, an unusual rules modification), use verb "other" and put the effect
  verbatim in object. Use it rather than forcing a near-miss verb — a wrong verb is consumed as if
  it were true, while "other" is honestly inert.
Return ONLY { "clauses": [ ... ] }.`;

/** The numbered clause list handed to the model. */
export function listClauses(clauses: Clause[]): string {
  return clauses.map((c) =>
    `${c.id}. [${c.kind}${c.marker ? ` ${c.marker}` : ""}]` +
    `${c.abilityType ? ` type=${c.abilityType}` : ""}${c.multiTrigger ? " twoConditions" : ""}` +
    `${c.cost ? ` cost="${c.cost}"` : ""}` +
    `${c.costActions ? ` costActions=[${c.costActions.join(",")}]` : ""}` +
    `${c.effectActions ? ` effectActions=[${c.effectActions.join(",")}]` : ""} ${c.text}`).join("\n");
}
