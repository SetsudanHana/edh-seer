/** How often an ability can fire, per turn CYCLE.
 *
 *  Spec: `docs/superpowers/specs/2026-08-11-repeatability-taxonomy-design.md`.
 *
 *  ORDERED BY RESTRICTIVENESS, and that ordering is what makes "first match wins" safe. An ability
 *  reading "{T}, once each turn" is capped by the tap, not by the sentence: {T} is once per ROUND
 *  and "once each turn" is once per TURN, so taking the text rule first would overstate it by the
 *  size of the pod. */
import type { Ability, Repeats } from "../schema.js";

/** Rules 1-2 read `cost`, not `clauseText`. `segment.ts`'s `classify()` already split an activated
 *  ability's cost out of the body -- Gogo, Master of Mimicry's clause is `text="Copy target
 *  activated or triggered ability you control X times."`, `cost="{X}{X}, {T}"` -- so a `clauseText`
 *  never carries the cost. The extracted cost has no trailing colon either (`act[1].trim()` in
 *  `classify()` captures everything BEFORE the colon), so neither pattern below anchors on one.
 *  `Ability.cost` is now populated with the real cost string in `derive.ts` (as of Task 1), but
 *  this function still takes it as its own positional argument: Rules 1-2 do NOT read `Ability.cost`,
 *  they read the `cost` parameter, so the two channels are independent and populating the field
 *  cannot move a `repeats` label or `REFUSED_CAP`. */

/** Sacrificing the card ITSELF is a one-shot; sacrificing A card of some type is a repeatable
 *  outlet, and conflating them would invert the answer on the commonest sacrifice shape there is.
 *
 *  Checked against ~60 real `clause.cost` strings (segmented `cards.oracleText`, filtered on a
 *  `sacrifice` cost). Self, every time: "Sacrifice this land", "Sacrifice this creature",
 *  "Sacrifice this artifact", "Sacrifice this Aura", "{T}, Sacrifice this land" (Escape Tunnel),
 *  "...and sacrifice it" (Goblin Bomb). NOT self, correctly left unmatched: "Sacrifice a Food",
 *  "Sacrifice a creature", "Sacrifice three Treasures", "Sacrifice another creature or artifact",
 *  "Sacrifice a creature of the chosen type", "Sacrifice a Goblin" -- all indefinite-article
 *  repeatable outlets. One compound shape found and deliberately NOT special-cased (a single card,
 *  Urborg Panther: "Sacrifice a creature named Feral Shadow, a creature named Breathstealer, and
 *  this creature" -- "this" appears but not directly after "sacrifice", so this stays unmatched and
 *  falls through to `repeatable`; narrowing the pattern for one card isn't worth it). A card
 *  sacrificing itself by its own printed NAME instead of "this"/"it" (The Filigree Sylex) is out of
 *  scope -- this function has no card name to compare against. */
/** ...and a cost that DISCARDS or EXILES the card itself is the same one-life shape (2026-09-05):
 *  channel ("{3}{U}, Discard this card:", Otawara) read `repeatable` and put a channel land among
 *  the removal ENGINES; "Exile this card from your graveyard:" is the same cost one zone over. */
const SACRIFICES_ITSELF = /\b(?:sacrifice|discard|exile) (?:this|it|~)\b/i;
/** Cost is already isolated to the pre-colon segment, so a bare presence check is enough --
 *  verified against real costs like "{T}, Sacrifice this land", "{1}, {T}, Sacrifice this creature",
 *  "{X}{R}, {T}, Sacrifice this creature". */
const TAP_COST = /\{[TQ]\}/;
const ONCE_EACH_TURN = /\bonce each turn\b/i;
/** "Whenever an opponent draws their second card each turn" (Faerie Mastermind) is bounded to once
 *  per that player's turn by the ORDINAL, not by a "once each turn" cost clause and not by the verb
 *  -- "draw" is not a phase verb. Measured against the corpus (609 cards carry "each turn"): every
 *  "first/second/third/.../each turn" line is either this shape (Rashmi, Lat-Nam Adept, Defacing
 *  Duskmage, 30+ more) or a static already caught by the `kind === "static"` check above it in the
 *  precedence order (Eluge's cost reduction, Fires of Invention's "no more than two spells each
 *  turn" -- "two" isn't ordinal so that one doesn't even match). A bare "each turn" with no ordinal
 *  (Spirit of the Labyrinth's "one card each turn") is deliberately NOT matched -- that is a
 *  continuous restriction, not a per-turn trigger, and would already be routed to `continuous` by
 *  the static check regardless. */
const ORDINAL_EACH_TURN = /\b(?:first|second|third|fourth|fifth)\b(?:(?!\.).){0,60}\beach turn\b/i;

/** Phases that happen on somebody's turn, so `control` says whose. "draw-step" was in the original
 *  brief but is not a member of the `Verb` union in `schema.ts` -- a draw-step trigger normalizes to
 *  `unknownTriggers` upstream and never reaches here as that verb, so it was dead. Dropped.
 *
 *  `attacks` is NOT a member here (2026-08-11 review, finding 3). Unlike upkeep/end-step/
 *  begin-combat, which happen once no matter how many permanents are on the battlefield, "attacks"
 *  fires once per ATTACKING CREATURE -- "whenever a creature you control attacks" is not once a
 *  round, it is once per attacker, the same repeatable shape as "whenever a creature you control
 *  dies". It is handled separately below, gated on `subject.self`: "whenever THIS creature attacks"
 *  really is once per cycle (there is exactly one of it), but a class-watching attacks trigger falls
 *  through to rule 9. 202 `attacks:you` abilities were mislabelled `per-cycle` by this before the
 *  fix -- the largest rule-6 group, per the design spec's §5 measurement. */
const PHASE_VERBS = new Set(["upkeep", "end-step", "begin-combat"]);

/** Trigger events that name the card's own arrival or departure -- they happen once. `sacrifice`,
 *  `enters-graveyard` and `cast` joined 2026-09-05: "when you sacrifice this", "when this card is
 *  put into a graveyard" and "when you cast this spell" are the same one-life shape. */
const SELF_EVENTS = new Set(["enters", "dies", "leaves", "sacrifice", "enters-graveyard", "cast"]);

/** The clause's OWN trigger event as the normalizer wrote it, and whose turn it names. Passed
 *  beside the derived ability because the derived ability cannot carry it: an event outside the
 *  `Verb` union -- `main-phase`, `draw-step`, `chapter` -- is routed to `unknownTriggers` upstream
 *  and the ability arrives here with NO trigger at all, which is how Black Market Connections
 *  ("at the beginning of your first main phase, choose one or more") sat refused in 21 of the 71
 *  decks while its draw mode was counted as a one-shot. Owner, 2026-09-05. */
export interface RawTrigger { event: string; control?: string }

/** Steps and phases the normalizer names that are not `Verb`s. Each happens once a turn, so the
 *  control split of rules 6-7 applies unchanged. The three that ARE verbs are listed too, so the
 *  raw read and the verb read cannot disagree about what a phase is. */
const RAW_PHASE_EVENTS: ReadonlySet<string> = new Set([
  "upkeep", "draw-step", "main-phase", "begin-combat", "combat-damage-step", "end-of-combat",
  "end-step", "cleanup", "untap-step",
]);

export function repeatsFor(ability: Ability, clauseText: string, cost = "", raw?: RawTrigger): Repeats | undefined {
  const text = clauseText ?? "";

  // 1-2: the cost, most restrictive first.
  if (SACRIFICES_ITSELF.test(cost)) return "once";
  if (TAP_COST.test(cost)) return "per-cycle";
  // 3: an explicit text limit. Faerie Mastermind's "each turn" and "Activate only once each turn"
  // both live in the body after the colon, not in the cost.
  if (ONCE_EACH_TURN.test(text)) return "per-turn";

  // 4-5: what the ability KIND settles on its own.
  if (ability.kind === "static") return "continuous";
  if (ability.kind === "on-cast") return "once";

  // 6-7 ON THE RAW EVENT, for the steps the `Verb` union does not carry (and, through a modal
  // continuation's inherited event, for every mode of such a trigger -- see `deriveAbilities`).
  if (raw && RAW_PHASE_EVENTS.has(raw.event)) return raw.control === "you" ? "per-cycle" : "per-turn";
  // A SAGA CHAPTER FIRES ONCE (CR 714.2b: the ability triggers as the lore-counter count reaches
  // its number, which happens once in the Saga's life). Blink and recursion are the card-level
  // bias §4.3 already states for `enters`. 532 corpus clauses, every one refused before this.
  if (raw?.event === "chapter") return "once";

  const trigger = ability.trigger;
  if (trigger) {
    const verbs = trigger.verbs as readonly string[];
    // 6-7: a phase trigger fires once per turn; `control` says whose turns count. An ordinal
    // "first/second/... each turn" trigger is bounded the same way even when the verb isn't a
    // phase verb -- Faerie Mastermind's "opponent draws their second card each turn" is `draw`.
    // `attacks` only counts as phase-shaped when it watches THIS creature (`self`) -- see
    // PHASE_VERBS's comment. A class-scoped attacks trigger (Doran, Besieged by Time: "whenever a
    // creature you control attacks ... it gets +X/+X") skips this branch and falls to rule 9.
    const selfAttacks = verbs.includes("attacks") && trigger.subject.self === true;
    if (verbs.some((v) => PHASE_VERBS.has(v)) || selfAttacks || ORDINAL_EACH_TURN.test(text)) {
      return trigger.subject.control === "you" ? "per-cycle" : "per-turn";
    }
    // 8: the card's OWN arrival happens once. "When this creature enters" against "whenever a
    // creature you control enters" -- same verb, opposite buckets, and only `self` separates them.
    if (trigger.subject.self === true && verbs.some((v) => SELF_EVENTS.has(v))) return "once";
    const typed = trigger.subject.type !== undefined || trigger.subject.subtype !== undefined;
    // 8b: COMBAT HAPPENS ONCE A TURN. "Whenever this creature deals combat damage to a player",
    // "whenever you attack", "whenever enchanted player is attacked" (Curse of Verbosity) each fire
    // at most once per combat, on whose turn `control` says -- the same split as a phase trigger.
    // Only the card's OWN combat or an UNTYPED one: "whenever a creature you control attacks" is
    // still once per attacker (finding 3, 2026-08-11) and falls to rule 9 below.
    const combat = verbs.includes("attacks") || verbs.includes("combat-damage");
    if (combat && (trigger.subject.self === true || !typed)) {
      return trigger.subject.control === "you" ? "per-cycle" : "per-turn";
    }
    // 9: anything watching a CLASS of objects fires as often as that class does something. A class
    // needs no TYPE to be one: "whenever an opponent draws a card" (Mind's Eye), "whenever you gain
    // life", "whenever a player casts a spell" watch an event any number of objects can cause. Only
    // the card's own event is not a class, and rule 8 has already taken the self shapes it can name.
    if (typed || trigger.subject.self !== true) return "repeatable";
    return undefined;
  }

  // 9 for activated abilities: no tap, no stated limit, so only resources bound it.
  if (ability.kind === "activated") return "repeatable";

  // 10: refused. Unlabelled beats mislabelled.
  return undefined;
}
