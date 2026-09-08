import type { CardTags, Control, SubjectFilter } from "@edh-seer/tagger";

/** THE OTHER SEAT (spec 2026-09-08, emblems as nodes). An emblem's text is written from its
 *  controller's point of view -- Chandra, Roaring Flame's reads "deals 3 damage to you" -- and CR
 *  114.2 makes the player who GETS it its controller. A deck analysed from our seat therefore reads
 *  an opponent's emblem with `you` and `opp` exchanged: the opponent's emblem hurts the opponent,
 *  from a source the opponent controls, and only a payoff that cares about an opponent being dealt
 *  damage by anything can join it. `any` is nobody's and stays `any`.
 *
 *  PURE. The tags are shared with every other deck that resolves the same emblem row, so the copy
 *  is deep on the fields it changes and shallow everywhere else. */
const swap = (c: Control | undefined): Control | undefined => (c === "you" ? "opp" : c === "opp" ? "you" : c);

const flipSubject = <T extends SubjectFilter | undefined>(s: T): T =>
  (s === undefined ? s : { ...s, control: swap(s.control) }) as T;

export function flipPerspective(tags: CardTags): CardTags {
  return {
    ...tags,
    abilities: tags.abilities.map((a) => ({
      ...a,
      ...(a.trigger ? { trigger: { ...a.trigger, subject: flipSubject(a.trigger.subject) } } : {}),
      effect: { ...a.effect, ...(a.effect.subject ? { subject: flipSubject(a.effect.subject) } : {}) },
      ...(a.emits ? {
        emits: a.emits.map((e) => ({
          ...e,
          subject: flipSubject(e.subject),
          ...(e.dealer ? { dealer: flipSubject(e.dealer) } : {}),
        })),
      } : {}),
    })),
  };
}
