/** WHICH TRIGGERS A TRIGGER-DOUBLER DOUBLES, read off the printed text.
 *
 *  Panharmonicon, Isshin and Drivnod derive byte-identically today — the clause layer records the
 *  OBJECT ("a triggered ability of a permanent you control") and drops the qualifier that says WHICH
 *  event's triggers are doubled. Measured 2026-08-22: 16 derived `trigger-doubling` abilities, 15
 *  carrying no subject at all, so the whole family forms no edge.
 *
 *  A CLOSED MAP, NEVER AN EVALUATOR — the same ruling the intervening-if work settled on. Three
 *  printed events, each an existing engine verb. Anything else records NOTHING and the card stays
 *  silent: Veyran ("instant or sorcery spell you cast"), Wayta and Harmonic Prodigy name a
 *  restriction on WHOSE ability rather than on WHICH event, which is a different axis with no slot.
 *  A near-miss here would make a doubler claim the wrong half of the deck, so refusal is the only
 *  correct failure direction.
 *
 *  READ FROM THE TEXT AND NOT FROM A NEW MODEL ANSWER, so this is free: no NORMALIZE_VERSION bump
 *  and no re-buy. Same move `reducesItself`, `triggerHasCue` and `ARRIVES_TAPPED` already make. */
import type { Verb } from "../schema.js";

/** The printed participle -> the engine verb whose triggers it doubles. */
const DOUBLED_EVENT: ReadonlyArray<readonly [RegExp, Verb]> = [
  [/\bentering\b/i, "enters"],
  [/\bdying\b/i, "dies"],
  [/\battacking\b/i, "attacks"],
];

/** Anchored on the printed frame, so an ordinary sentence containing "entering" cannot match. Both
 *  orders appear: "If an artifact or creature entering causes a triggered ability ..." and
 *  "... causes a triggered ability of a permanent you control to trigger". */
const DOUBLER_FRAME = /causes? a triggered ability/i;

/** The events whose triggers this text says it doubles. Empty when the text names none this map
 *  holds — which is a refusal, not a failure. */
export function doubledVerbs(text: string): Verb[] {
  if (!DOUBLER_FRAME.test(text)) return [];
  // Only the span BEFORE the frame qualifies the event; the tail ("that ability triggers an
  // additional time") never does, and on some cards names an unrelated word.
  const head = text.slice(0, text.search(DOUBLER_FRAME));
  const out: Verb[] = [];
  for (const [re, verb] of DOUBLED_EVENT) if (re.test(head) && !out.includes(verb)) out.push(verb);
  return out;
}
