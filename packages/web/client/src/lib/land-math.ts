// The one function, not a copy of it -- but via the SUBPATH, never the package barrel.
// `@edh-seer/engine`'s index pulls analyze.ts, which readFileSync's its tag weights at module load, and
// that throws "The URL must be of scheme file" the moment a browser or jsdom evaluates it. The
// subpath exists so the client can reach pure computation without dragging Node in with it.
// (Type-only imports of the barrel stay fine: they erase.)
import { comb as combinations } from "@edh-seer/engine/hypergeometric";

/** Hypergeometric distribution: probability of drawing exactly k lands in a hand of
 *  `handSize` cards from a `deckSize`-card deck containing `landCount` lands, for
 *  k = 0..handSize. No mulligan modeling — plain opening-hand odds. */
export function landHandProbabilities(landCount: number, deckSize: number, handSize = 7): number[] {
  if (deckSize < handSize || deckSize <= 0) return new Array(handSize + 1).fill(0);
  const total = combinations(deckSize, handSize);
  const probs: number[] = [];
  for (let k = 0; k <= handSize; k++) {
    if (k > landCount || handSize - k > deckSize - landCount) {
      probs.push(0);
      continue;
    }
    probs.push((combinations(landCount, k) * combinations(deckSize - landCount, handSize - k)) / total);
  }
  return probs;
}

/** THE TWO-LAND KEEP, AS ODDS (baseline round 2026-09-26). The slow-deck seat kept two lands, never
 *  drew a third, and asked whether that was bad luck or the deck; the page gave opening-hand odds
 *  only, and r/EDH's answers never settle it either. The honest answer is a number: how often a
 *  two-land keep finds its third land in time, with this land count and with two more.
 *
 *  Lands only: cheap ramp that fetches a land helps a little more, and the page says so. `draws` is
 *  how many cards are drawn before the land drop in question (2 by the turn-3 drop on the play, 3 on
 *  the draw). */
export function nextLandChance(landCount: number, deckSize: number, draws: number, keptLands = 2, handSize = 7): number {
  const library = deckSize - handSize;
  const lands = landCount - keptLands;
  if (lands <= 0 || library <= 0) return 0;
  if (draws >= library) return 1;
  return 1 - combinations(library - lands, draws) / combinations(library, draws);
}
