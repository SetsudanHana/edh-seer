/** CR 603.4's INTERVENING IF: "Whenever X, **if Y**, do Z." The condition is checked when the
 *  ability would trigger and again on resolution, so it constrains the event INSTANCE — not the
 *  subject class, which is what `SubjectFilter` records, and not the effect.
 *
 *  The engine has no slot for it. `trigger.threshold` holds the numeric `{atLeast}` subset and
 *  everything else is dropped silently, so a trigger derives WIDER than printed: Yuna, Grand
 *  Summoner's "whenever another permanent you control is put into a graveyard from the battlefield,
 *  IF IT HAD ONE OR MORE COUNTERS ON IT" derives as a bare sacrifice watcher. Her three producers in
 *  her own deck are all Sagas and all correct — because a Saga always has lore counters when it dies
 *  — so the engine is right BY COINCIDENCE, and the first counterless sacrifice outlet in that deck
 *  turns those claims false with nothing watching.
 *
 *  This module is the instrument, not the fix: `bin/intervening-if-audit.ts` counts what is
 *  unrepresented and `intervening-if-ratchet.test.ts` stops the count growing.
 *  → `specs/2026-08-15-fable-gap-review.md` §3.1 */

/** A trigger sentence, so a bare "if" inside an effect body is not mistaken for one. */
const TRIGGER_OPENER = /^\s*(?:whenever|when|at the beginning of|at end of)\b/i;

/** The condition itself: a comma, then "if", then everything up to the next comma that ends it.
 *  Anchored on the COMMA on both sides because that is what CR 603.4's template prints. */
const CONDITION = /,\s*if\s+([^,.]+)/i;

/** "If" that is not a condition on the trigger.
 *   - "if you do" / "if you don't" — the follow-up to an optional cost inside the effect.
 *   - "if able" — a rules qualifier on an instruction.
 *   - "if it would" — a replacement clause (CR 614), which `replacement.ts` owns.
 *   - "if that spell" / "if this creature" — a rider on the effect, not on the event. */
const NOT_A_CONDITION = /^(?:you (?:do|don't|didn't|can't)|able|it would|they do)\b/i;

/** The condition phrase of a trigger's intervening if, or null. Reads ONE sentence: pass the clause
 *  text, which `segment()` has already split. */
export function interveningIfOf(text: string): string | null {
  if (!TRIGGER_OPENER.test(text)) return null;
  const m = text.match(CONDITION);
  if (!m) return null;
  const cond = m[1].trim();
  return NOT_A_CONDITION.test(cond) ? null : cond;
}

/** The families the corpus prints, so the audit can say WHICH conditions a slot would have to
 *  express rather than reporting one undifferentiated pile. `other` is honest: an unlabelled
 *  condition is one nobody has looked at yet. */
export type ConditionFamily = "counter-presence" | "cast-entry" | "was-a-type" | "zone-or-state"
  | "count-threshold" | "life" | "control" | "turn-timing" | "other";

const FAMILIES: { family: ConditionFamily; re: RegExp }[] = [
  { family: "counter-presence", re: /\bcounters?\b/i },
  // "if you cast it" — the entry was a CAST, not a token, a reanimation or a blink. The engine
  // already spells the distinction on the producer side (`impliedEvents` pushes a `cast` for every
  // nonland card), so this family is the one most likely to be cheap.
  { family: "cast-entry", re: /\byou cast (?:it|this|that)\b/i },
  // "if it was a creature" — the Enduring cycle, a condition on what the object WAS in a zone it has
  // already left. Not expressible by any subject filter, which describes what a card IS.
  { family: "was-a-type", re: /\bit was an? \b/i },
  { family: "count-threshold", re: /\b(?:one or more|two or more|three or more|\d+ or (?:more|greater|fewer|less)|at least)\b/i },
  { family: "life", re: /\blife\b/i },
  { family: "turn-timing", re: /\b(?:your turn|this turn|first|second|during)\b/i },
  { family: "control", re: /\b(?:you control|an opponent controls|control (?:no|a|an))\b/i },
  { family: "zone-or-state", re: /\b(?:in your graveyard|on the battlefield|in exile|in your hand|tapped|untapped|face)\b/i },
];

export function conditionFamily(condition: string): ConditionFamily {
  return FAMILIES.find((f) => f.re.test(condition))?.family ?? "other";
}

/** THE DEMAND A CONDITION MAKES ON THE DECK, as ordinary `cares` tags.
 *
 *  Owner's framing, 2026-08-20: an intervening if forms no edge, but it still says what the card
 *  NEEDS around it — "Yuna should score more in a counters deck", Warlock Class is an aristocrats
 *  payoff, Alesha cares about attacking. The condition is a CONSUMING side even when no single
 *  producer satisfies it, and `cardCaresTags` is exactly the channel: it feeds `rankFreq` at full
 *  weight, then the axis, then `axisWeight` and the rating.
 *
 *  **A CLOSED MAP, NOT AN EVALUATOR.** The 2026-08-15 refusal stands — the corpus prints 241 distinct
 *  conditions and a slot general enough to EVALUATE them is a second rules engine. This does not
 *  evaluate anything: it recognises four printed shapes and emits a tag the theme layer already
 *  speaks. Everything else returns nothing, which is the honest answer for "it was kicked".
 *
 *  DELIBERATELY OMITTED: `control` and `life` conditions ("you control a red permanent", "the player
 *  with the most life"). They are real DECK-FIT facts — Oath of Liliana in a deck with no
 *  planeswalkers is a bad card, measured at 1 of 33 such slots across the 71 decks — but a colour or
 *  a player's life total is not a theme any card supplies, so a cares tag would be a category error.
 *  That belongs on the cut list, not the axis. Also omitted: `cast-entry` ("if you cast it"), which
 *  narrows the EVENT rather than naming a deck demand. */
export function conditionCares(condition: string): string[] {
  const out: string[] = [];
  // "if it had one or more counters on it" (Yuna, Iron Apprentice), "if The Ozolith has counters on
  // it". The kind is not read: a subject key of `any` is what the counter theme already uses, and
  // guessing "+1/+1" would claim more than the text says.
  if (/\bcounters?\b/i.test(condition)) out.push("counter-added:any");
  // "if a creature died this turn" (Warlock Class) — the aristocrats demand.
  if (/\b(?:a|another|one or more) creatures? (?:died|has died|have died)\b/i.test(condition)) out.push("dies:creature");
  // "if you attacked this turn" (Alesha) — the aggro demand.
  if (/\byou(?:'ve)? attacked\b|\byou have attacked\b/i.test(condition)) out.push("attacks:any");
  // "if a planeswalker entered the battlefield under your control this turn" (Oath of Liliana,
  // Oath of Chandra).
  const entered = condition.match(/\ban? (planeswalker|creature|artifact|enchantment|land) entered\b/i);
  if (entered) out.push(`enters:${entered[1].toLowerCase()}`);
  return [...new Set(out)];
}
