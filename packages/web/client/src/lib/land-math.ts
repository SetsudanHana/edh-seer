/** n-choose-k via the standard multiplicative running-product formula — avoids
 *  computing raw factorials (which overflow `number` well before n=99). */
function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const j = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < j; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

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
