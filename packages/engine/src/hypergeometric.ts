/** Hypergeometric primitives for the deck-math layer.
 *
 *  These four functions are the substrate every later step reads: category availability, θ*, the
 *  Karsten land count's confidence checks, castability. They are Tier A -- exact combinatorics
 *  over a known library size, nothing fitted and nothing guessed.
 *
 *  WHAT THEY DO NOT MODEL, and it matters at every call site:
 *  - **No mulligans.** EDH's free first mulligan plus London shifts required counts by about one
 *    card. The Karsten regression absorbs it for lands; nothing absorbs it here.
 *  - **`seen(T) = 7 + T` ignores card draw**, so every figure is CONSERVATIVE for a deck that
 *    draws, and the error compounds (cantrips draw cantrips).
 *  - **No opponent.** Nothing is countered, killed, taxed or Stax'd, so results skew optimistic
 *    exactly where interaction is heaviest.
 *  - **`jointAvailability` assumes disjoint groups**, and our build categories overlap on purpose
 *    (`doubleDutyRating` exists because of it). See its own doc comment.
 *
 *  Source: the external blueprint spec §1. Its §9 acceptance values were RECOMPUTED before this
 *  file was written (2026-08-11) rather than trusted -- see hypergeometric.test.ts. */

/** n-choose-k via the multiplicative running product.
 *
 *  Not a factorial ratio: 99! overflows `number` to Infinity, and Infinity/Infinity is NaN, so the
 *  textbook form fails on the only deck size this project cares about. Dividing as it goes keeps
 *  every intermediate near the final magnitude instead.
 *
 *  Moved up out of the client's land-math.ts, which had its own private copy. */
export function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const j = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < j; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

/** The default library size: 99, because the commander sits in the command zone.
 *
 *  Which is also the one card this whole layer gets WRONG in the user's favour if the commander is
 *  the piece being counted -- it is available in every game, P = 1, not drawn from a hat. Callers
 *  counting a category the commander belongs to must handle it (stub §10.1). */
export const LIBRARY = 99;

/** Cards seen by turn `T`: the 7-card opener plus one draw per turn, including turn 1 -- in EDH
 *  even the player on the play draws.
 *
 *  Exact only for a deck with NO card draw, and it understates every other deck. Deliberately kept
 *  as the spec's flat formula rather than guessed at: a wrong correction is worse than a stated
 *  bias. See stub §10.5. */
export function seen(turn: number): number {
  return 7 + turn;
}

/** P(at least `k` successes) when drawing `n` cards from `N` with `S` successes in the library.
 *
 *  Summed from the tail the caller asked for, not as `1 - P(< k)`: for the large-`k` questions this
 *  layer asks ("6 lands by turn 6") the complement is a sum of many larger terms whose cancellation
 *  costs precision, while the tail itself is a handful of terms of the same magnitude as the
 *  answer. */
export function pAtLeast(k: number, S: number, n: number, N: number = LIBRARY): number {
  if (S < 0 || n < 0 || N <= 0 || S > N || n > N) return 0;
  let total = 0;
  const top = Math.min(S, n);
  for (let i = Math.max(k, 0); i <= top; i++) {
    if (n - i > N - S) continue;
    total += (comb(S, i) * comb(N - S, n - i)) / comb(N, n);
  }
  // Floating point can leave 1 + 2e-16 when every draw is a success, and a probability above 1
  // reads as a bug at every call site downstream.
  return Math.min(total, 1);
}

/** The fewest copies of a card so that `P(>= k of them by turn) >= conf`.
 *
 *  THROWS when no copy count reaches the confidence -- e.g. 8 copies by turn 0, which a 7-card
 *  opener cannot deliver at any deck composition. Returning `N` there would read as "play 99 of
 *  them" instead of "the question has no answer", and a silent wrong answer is worse than a
 *  missing one. */
export function minCopies(k: number, turn: number, conf: number, N: number = LIBRARY): number {
  const n = seen(turn);
  for (let S = 1; S <= N; S++) {
    if (pAtLeast(k, S, n, N) >= conf) return S;
  }
  throw new Error(
    `minCopies: P(>= ${k} by turn ${turn}) >= ${conf} is unreachable at any copy count in ${N}`,
  );
}

/** P(at least one card from EVERY group), drawing `n` from `N`. Exact, by inclusion-exclusion over
 *  which groups are missed.
 *
 *  **THE GROUPS MUST BE DISJOINT.** A card counted in two groups makes this optimistic, and our
 *  build categories overlap deliberately -- a Dockside is ramp AND a token maker. The guard below
 *  only catches groups that cannot possibly be disjoint (they sum past the library); ordinary
 *  overlap is invisible here and has to be handled by the caller, either by partitioning the cards
 *  into membership classes (stub §10.2 -- exact, 2^d classes, and cheap for the d = 3..5 this
 *  layer uses) or by shipping the caveat with the number.
 *
 *  Cost is 2^d, so it is fine for a chain of a handful of roles and not a general tool. */
export function jointAvailability(
  groupSizes: readonly number[],
  n: number,
  N: number = LIBRARY,
): number {
  const d = groupSizes.length;
  const sum = groupSizes.reduce((a, b) => a + b, 0);
  if (sum > N) {
    throw new Error(
      `jointAvailability: groups sum to ${sum} in a library of ${N}, so they cannot be disjoint`,
    );
  }
  let total = 0;
  for (let mask = 0; mask < 1 << d; mask++) {
    let missed = 0;
    let bits = 0;
    for (let i = 0; i < d; i++) {
      if (mask & (1 << i)) {
        missed += groupSizes[i];
        bits++;
      }
    }
    const rem = N - missed;
    if (rem >= n) total += (bits % 2 === 0 ? 1 : -1) * (comb(rem, n) / comb(N, n));
  }
  return Math.min(Math.max(total, 0), 1);
}
