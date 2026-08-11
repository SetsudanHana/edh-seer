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
 *  `Ability.cost` is NOT the channel: `derive.ts` sets it to `""` for every activated ability
 *  corpus-wide, so it is always empty. The caller must thread the real per-clause cost string in. */

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
const SACRIFICES_ITSELF = /\bsacrifice (?:this|it|~)\b/i;
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
 *  `unknownTriggers` upstream and never reaches here as that verb, so it was dead. Dropped. */
const PHASE_VERBS = new Set(["upkeep", "end-step", "begin-combat", "attacks"]);

/** Trigger events that name the card's own arrival or departure -- they happen once. */
const SELF_EVENTS = new Set(["enters", "dies", "leaves"]);

export function repeatsFor(ability: Ability, clauseText: string, cost = ""): Repeats | undefined {
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

  const trigger = ability.trigger;
  if (trigger) {
    const verbs = trigger.verbs as readonly string[];
    // 6-7: a phase trigger fires once per turn; `control` says whose turns count. An ordinal
    // "first/second/... each turn" trigger is bounded the same way even when the verb isn't a
    // phase verb -- Faerie Mastermind's "opponent draws their second card each turn" is `draw`.
    if (verbs.some((v) => PHASE_VERBS.has(v)) || ORDINAL_EACH_TURN.test(text)) {
      return trigger.subject.control === "you" ? "per-cycle" : "per-turn";
    }
    // 8: the card's OWN arrival happens once. "When this creature enters" against "whenever a
    // creature you control enters" -- same verb, opposite buckets, and only `self` separates them.
    if (trigger.subject.self === true && verbs.some((v) => SELF_EVENTS.has(v))) return "once";
    // 9: anything watching a CLASS of objects fires as often as that class does something.
    if (trigger.subject.type !== undefined || trigger.subject.subtype !== undefined) return "repeatable";
    return undefined;
  }

  // 9 for activated abilities: no tap, no stated limit, so only resources bound it.
  if (ability.kind === "activated") return "repeatable";

  // 10: refused. Unlabelled beats mislabelled.
  return undefined;
}
