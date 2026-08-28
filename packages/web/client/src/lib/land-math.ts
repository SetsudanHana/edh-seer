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
