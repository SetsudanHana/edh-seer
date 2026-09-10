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
 *  CEILING, RECORDED THE DAY IT SHIPPED: this map holds the EVENT and drops the TYPE NARROWING
 *  beside it. Panharmonicon says "an artifact or creature entering", Naban "a Wizard you control",
 *  Gandalf "a legendary permanent or an artifact", Ancient Greenwarden "a LAND". Only four of the
 *  twelve — Yarok, Elesh Norn, Starfield Vocalist, Virtue of Knowledge — say the unrestricted "a
 *  permanent", where the recorded verb is the whole story.
 *
 *  MEASURED over the 71 decks: 102 claims come from a type-narrowed doubler and none is measurably
 *  false, because the narrowings that ARE played are satisfied nearly always in the decks that play
 *  them (artifact-or-creature covers most ETB permanents; Naban's Wizard restriction sits in a
 *  WIZARD deck; Gandalf's legendary restriction in a legends deck). The sharp case is **Ancient
 *  Greenwarden, which doubles LANDFALL only** — claiming it doubles a creature's ETB is plainly
 *  wrong, and it is safe today solely because no calibration deck runs it.
 *
 *  Closing it needs the qualifier's SUBJECT recorded beside the verb and checked against the
 *  consumer's trigger subject. Deliberately not built with the verb: that is a second field and a
 *  second matcher condition, and the population that would exercise it is one unplayed card.
 *
 *  READ FROM THE TEXT AND NOT FROM A NEW MODEL ANSWER, so this is free: no NORMALIZE_VERSION bump
 *  and no re-buy. Same move `reducesItself`, `triggerHasCue` and `ARRIVES_TAPPED` already make. */
import type { SubjectFilter, Verb } from "../schema.js";
import { parseSubject } from "./subject.js";

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

/** The WHOSE frame: "If a triggered ability of <class> triggers, that ability triggers an additional
 *  time." Distinct from the event frame above ("if <event> causes a triggered ability of a permanent
 *  you control to trigger"), which names WHICH event and always says "a permanent you control" for
 *  whose. Lazy, so a trailing condition ("... triggers while you control six or more Shrines",
 *  Sanctum of All) is not read into the class. */
const WHOSE_FRAME = /\ba triggered ability of (.+?) triggers\b/i;

/** WHOSE triggered abilities this text says it doubles, as a class the deck can be searched for;
 *  undefined when the frame is absent or the class is the whole board. Recorded only when the
 *  subject narrows past "a permanent / creature you control" on some axis the matcher can test
 *  against a card's printed characteristics: a subtype, a legendary supertype, the chosen type, a
 *  stats predicate, a colour. A recipient the parser reads as nothing narrower (Mirror Room's "a
 *  permanent you control", Wizard's Staff's "equipped creature") is a refusal, not a wildcard --
 *  the same gate a grant's recipient passes in derive.ts. `other` is dropped: a pair is never the
 *  card and itself. */
export function doublesOf(text: string): SubjectFilter | undefined {
  const m = text.match(WHOSE_FRAME);
  if (!m) return undefined;
  const { other: _other, ...s } = parseSubject(m[1]!);
  const bounded = s.subtype !== undefined || s.legendary === true || s.chosenType === true
    || (s.stats?.length ?? 0) > 0 || (s.colors?.length ?? 0) > 0 || s.commander === true;
  return bounded ? s : undefined;
}
