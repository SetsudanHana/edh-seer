/** How often an ability can fire, per turn CYCLE.
 *
 *  Spec: `docs/superpowers/specs/2026-08-11-repeatability-taxonomy-design.md`.
 *
 *  ORDERED BY RESTRICTIVENESS, and that ordering is what makes "first match wins" safe. An ability
 *  reading "{T}, once each turn" is capped by the tap, not by the sentence: {T} is once per ROUND
 *  and "once each turn" is once per TURN, so taking the text rule first would overstate it by the
 *  size of the pod. */
import type { Ability, Repeats } from "../schema.js";

/** Sacrificing the card ITSELF is a one-shot; sacrificing A card of some type is a repeatable
 *  outlet, and conflating them would invert the answer on the commonest sacrifice shape there is.
 *
 *  Checked against real corpus text (segmented `cards.oracleText`, not `cardClauses` -- that
 *  collection stores structured actions, not text). "Sacrifice this token/creature/artifact/
 *  enchantment/land/permanent:" is self, every time it appears (Incubator Drone, Era of Innovation,
 *  Blitzball, ...). "Sacrifice a creature:", "Sacrifice a Food.", "Sacrifice a Blood:" are
 *  repeatable outlets and are correctly left unmatched by this pattern -- they start with the
 *  indefinite article, not "this"/"it"/"~". A card that sacrifices itself by its own printed NAME
 *  instead of "this" (The Filigree Sylex: "...sacrifice The Filigree Sylex:") is not caught here --
 *  this function has no card name to compare against, and that is out of scope for this rule. */
const SACRIFICES_ITSELF = /sacrifice (?:this|it|~)\b[^:]{0,20}:/i;
/** Verified against real corpus shapes, including odd labels before the tap (Loopy Lobster:
 *  "Stage 4 — Vigilance. {T}: Draw 2 cards.", Susur Secundi: "12+ | {1}{B}, {T}, Pay 2 life,
 *  Sacrifice a creature: ..."). In every real match found, the {T}/{Q} genuinely belongs to THAT
 *  ability's own cost -- segmentation leaves a label's punctuation (em dash, pipe, "!") in front of
 *  the cost rather than stripping it, it never welds two unrelated abilities' text together on one
 *  clause. No false positive turned up, so the anchor is left as given rather than narrowed on a
 *  hypothetical. */
const TAP_COST = /^[^:]{0,40}\{[TQ]\}[^:]{0,40}:/;
const ONCE_EACH_TURN = /\bonce each turn\b/i;

/** Phases that happen on somebody's turn, so `control` says whose. */
const PHASE_VERBS = new Set(["upkeep", "end-step", "begin-combat", "draw-step", "attacks"]);

/** Trigger events that name the card's own arrival or departure -- they happen once. */
const SELF_EVENTS = new Set(["enters", "dies", "leaves"]);

export function repeatsFor(ability: Ability, clauseText: string): Repeats | undefined {
  const text = clauseText ?? "";

  // 1-3: cost and explicit limits, most restrictive first.
  if (SACRIFICES_ITSELF.test(text)) return "once";
  if (TAP_COST.test(text)) return "per-cycle";
  if (ONCE_EACH_TURN.test(text)) return "per-turn";

  // 4-5: what the ability KIND settles on its own.
  if (ability.kind === "static") return "continuous";
  if (ability.kind === "on-cast") return "once";

  const trigger = ability.trigger;
  if (trigger) {
    const verbs = trigger.verbs as readonly string[];
    // 6-7: a phase trigger fires once per turn; `control` says whose turns count.
    if (verbs.some((v) => PHASE_VERBS.has(v))) {
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
