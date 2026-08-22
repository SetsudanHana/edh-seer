import { pAtLeast, seen } from "@mtg/engine";
import type { Cohesion } from "@mtg/engine";

/** THE TURN AND THE COUNT THE PROBABILITY IS ASKED AT, and both are DOCTRINE rather than fits.
 *
 *  Turn 3 and two copies are the Card Kingdom consistency article's own choice, adopted as stated
 *  doctrine — the same status `BASE_TARGETS` carries. **Fitting them to the 71 calibration decks is
 *  the self-comparison trap** this project has recorded four times, so they are NOT swept.
 *
 *  The article's headline row reproduces exactly against this engine's own `pAtLeast`/`seen`:
 *  30 cards, two by turn 3, 86.9%. `thing.test.ts` pins it. */
export const THING_TURN = 3;
export const THING_K = 2;

export interface DeckThing {
  /** The theme phrase a reader sees — cohesion's own label, never a second name for it. */
  theme: string;
  tag: string;
  /** Distinct NONLAND, NON-COMMANDER cards that do it. The number the sentence quotes. */
  count: number;
  cards: string[];
  /** Commanders doing the thing. NEVER inside `count`: a commander is available in every game at
   *  P = 1, so folding it into a draw probability understates the deck (the same rule
   *  `deck-math.ts` applies with `fromCommandZone`). Stated beside the count instead. */
  fromCommandZone: string[];
  turn: number;
  k: number;
  /** P(at least `k` of the `count` cards drawn by `turn`). */
  probability: number;
}

/** "N cards do this deck's thing, and two of them by turn 3 is P%".
 *
 *  A JOIN, NOT NEW ANALYSIS: the card set is the cohesion numerator (roadmap K1 took candidate (a)),
 *  and the probability is `pAtLeast`, which the deck-math layer has used since 2026-08-11. Nothing
 *  here forms an edge, reads a rating or moves a score, which is the acceptance test.
 *
 *  IT ABSTAINS EXACTLY WHERE COHESION ABSTAINS. `cohesion.dominant === false` means the theme layer
 *  declined to name the deck (A15), and printing "6 cards do this deck's thing" under a withdrawn
 *  claim would put the number back in the reader's hands after the sentence was taken out of them.
 *  5 of the 6 owner-named control decks land there, and that is CORRECT under the owner's own
 *  ruling that control is a MEANS rather than a thing — the means slot carries them, so there is no
 *  fallback to invent.
 *
 *  NEVER MULTIPLIED INTO A SCORE (registered, and the `castability.ts` never-multiply ruling one
 *  layer over): P(drawn) is not P(castable) and neither is a rating. */
export function deckThing(
  cohesion: Cohesion | null,
  onThemeCards: readonly string[],
  commanderNames: ReadonlySet<string>,
  librarySize: number,
): DeckThing | null {
  if (!cohesion || cohesion.dominant === false) return null;
  const cards = onThemeCards.filter((n) => !commanderNames.has(n));
  const fromCommandZone = onThemeCards.filter((n) => commanderNames.has(n));
  return {
    theme: cohesion.theme,
    tag: cohesion.tag,
    count: cards.length,
    cards,
    fromCommandZone,
    turn: THING_TURN,
    k: THING_K,
    probability: pAtLeast(THING_K, cards.length, seen(THING_TURN), librarySize),
  };
}
