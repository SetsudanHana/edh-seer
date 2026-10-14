/** THE TWO NUMBERS A DECK IS ASKED "DOES IT HAVE ENOUGH OF X" WITH (#1191): the turn and the confidence bar. ONE COPY, in a module with no imports, so `deck-math.ts` (the answers table, the
 *  Karsten inputs) and `gate.ts` (a gate's board count) read the same pair without a cycle -- `deck-math` reaches `gate` through land-score and same-job, which is why `gate.ts` once carried copies. */

/** The turn a deck with NO combat clock is priced at: the median measured clock across the 71
 *  calibration decks, which is 9.5, taken DOWN to 9.
 *
 *  Measured rather than chosen -- the fixed turn 5 this replaces was a placeholder nothing
 *  anchored, and design §10.8's whole complaint is that target turns are Tier C guesses. Rounded
 *  down because a shorter horizon sees fewer cards and so understates availability: if this default
 *  is wrong, it should be wrong in the direction that does not flatter the deck. */
export const CORPUS_MEDIAN_CLOCK = 9;

/** The confidence `required_k` inverts: "more often than not, this deck has an answer of this class
 *  in hand by its own clock" (design §12.3, owner's call 2026-08-11).
 *
 *  CHOSEN AGAINST MEASUREMENT, which is the whole reason it is not the spec's proposed 75%. At the
 *  corpus median clock of T9, the count each threshold demands and the decks of 71 that clear it:
 *
 *  | threshold | k | creature | artifact | enchantment | planeswalker | graveyard | land |
 *  |---|---|---|---|---|---|---|---|
 *  | 50% | 4 | 56 | 31 | 19 | 24 | 9 | 6 |
 *  | 60% | 6 | 38 |  9 |  9 |  9 | 1 | 2 |
 *  | 75% | 8 | 19 |  4 |  3 |  3 | 0 | 0 |
 *  | 90% | 13 | 1 |  0 |  0 |  0 | 0 | 0 |
 *
 *  At 75% two classes are 0/71 and nothing else clears 27%; at 90% the whole corpus fails
 *  everything. A gauge that reads "broken" on all 71 decks cannot rank them, and the roadmap's "Tier
 *  C" note understated the problem — 75% is not merely unanchored, it is SATURATED.
 *
 *  The low absolute pass rates at 50% are not a mis-set bar. The doctrine's claim is precisely that
 *  decks under-run graveyard hate and land interaction, and 9/71 and 6/71 is that claim measured. */
export const REQUIRED_CONFIDENCE = 0.5;
