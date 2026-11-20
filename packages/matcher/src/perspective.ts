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

/** A TOKEN AN OPPONENT RECEIVES FROM YOUR CARD (#1666): Beast Within's Beast, Overencumbered's Clue, Food and Junk. The token's own text is written for whoever controls it, and that is the opponent, so the
 *  node is read from their seat: `flipPerspective` for what its abilities say, and `heldByOpponent` for what it IS (its own enters and dies, and the filter a producer must meet to make it). A payoff of tokens "you
 *  control" then fails to hear it, and one of any control ("whenever an artifact is put into a graveyard", Disciple of the Vault) or of an opponent's does.
 *  CEILING: a keyword the token carries (`keywordAbilities`) is still read from your seat; none of the opponent-given tokens in the corpus has a keyword whose trigger a payoff hears. */
export function opponentHeld(tags: CardTags): CardTags {
  const flipped = flipPerspective(tags);
  return { ...flipped, characteristics: { ...flipped.characteristics, heldByOpponent: true } };
}
