import { comb, pAtLeast, pCanPay, seen } from "@edh-seer/engine";

/** EDH MULLIGAN POLICY, IN CLOSED FORM. No simulation is needed for a land-count question, and
 *  that is the whole point of this module.
 *
 *  WHY IT EXISTS. `hypergeometric.ts` models no mulligans, and every land figure this repo quoted
 *  was therefore raw — which made "37 lands hits three land drops 90% of the time" read 80.0% and
 *  look refuted. It is not refuted; it is **90.3%** once the mulligan is priced. The owner caught
 *  this by asking whether the math assumed the free London mulligan (2026-08-23), and the missing
 *  term had been named in `hypergeometric.ts`'s own header the entire time.
 *
 *  THE POLICY, as the owner stated it: the first mulligan in Commander is FREE (draw seven fresh,
 *  bottom none) and in a casual game it is fine to go down to six. That is at most two mulligans —
 *  keep 7, keep 7, then a forced 6 — and London means each hand is an INDEPENDENT draw of seven,
 *  because the old hand shuffles back before the new one is drawn.
 *
 *  WHY IT IS CLOSED FORM. A keep rule that reads only the hand's LAND COUNT has eight states (0-7),
 *  so the policy is a finite mixture of hypergeometrics. The one structural fact that makes London
 *  bottoming tractable: the bottomed card goes UNDER the library, so the first three draws always
 *  come from the 92 never-drawn cards holding `lands - j` lands whatever you chose to bottom.
 *  Bottoming moves a land between the hand and somewhere unreachable, and nothing else.
 *
 *  VERIFIED TWO WAYS: this closed form and a 400,000-trial Monte Carlo agree inside the simulation's
 *  95% interval at every cell measured (37 lands, keep {2,3,4}: 0.9029 against 0.9036 +/- 0.0009).
 *  The two are different methods on purpose — re-running a derivation cannot reveal a systematic
 *  error in it.
 *
 *  WHAT IT STILL DOES NOT MODEL: a keep decision that reads anything but the land count (gas, curve,
 *  colours), and card draw compounding after the keep. Those are where simulation genuinely starts. */

/** P(exactly `j` successes), from `pAtLeast` differences so this file holds no second copy of the
 *  combinatorics `hypergeometric.ts` already owns. */
const exactly = (j: number, successes: number, draw: number, size: number): number =>
  pAtLeast(j, successes, draw, size) - pAtLeast(j + 1, successes, draw, size);

/** The land counts a player keeps a seven-card hand on. `{2,3,4}` is the standard band; the sweep
 *  in `bin/mulligan-policy.ts` shows the answer moves by at most one land across every band a real
 *  player uses. */
export const STANDARD_KEEP = new Set([2, 3, 4]);

const DECK = 99;
const HAND = 7;
/** Cards never drawn once a seven-card hand is off the top -- the only cards the early draws can
 *  reach, since a bottomed card is under everything. */
const REACHABLE = DECK - HAND;

/** Lands left in hand after London bottoming on the forced six: shave an excess land when the hand
 *  is flooded, otherwise bottom a spell and keep every land.
 *
 *  MEASURED IRRELEVANT for the land-drop question, and worth knowing: bottoming a land from a
 *  five-plus-land hand never crosses the "at least three" threshold, so this rule and a rule that
 *  never bottoms a land agree to four decimals. It matters for a question about the hand's own
 *  composition, not about hitting drops. */
const bottomed = (j: number): number => (j >= 5 ? j - 1 : Math.min(j, HAND - 1));

/** P(seeing at least `need` cards of a category of size `size` by `turn`), under the owner's policy.
 *
 *  THE KEEP BAND IS A LAND BAND, so this is EXACT for lands and an UPPER BOUND on the mulligan's
 *  help for anything else (roadmap L5). Applied to "sources of one colour" it models a player who
 *  mulligans on black sources specifically, which nobody does -- a real player keeps on lands, which
 *  tracks the colour category only partly. For a mono-coloured deck the two nearly coincide; for a
 *  five-colour deck this reads optimistic. Its counterpart bound is the RAW figure (`minCopies`,
 *  no mulligan at all), which under-states by the same mismatch, so the pair is reported and neither
 *  is deleted. */
export function pByTurn(
  size: number, need: number, turn: number, keep: ReadonlySet<number> = STANDARD_KEEP,
): number {
  const draws = seen(turn) - HAND;
  const afterKeep = (inHand: number, drawn: number): number =>
    pAtLeast(need - inHand, size - drawn, draws, REACHABLE);

  // The forced six: no choice left, so every hand is played out.
  let stage = 0;
  for (let j = 0; j <= HAND; j++) stage += exactly(j, size, HAND, DECK) * afterKeep(bottomed(j), j);

  // Hand 2 (the free mulligan) then hand 1, each keeping on the band and otherwise falling through
  // to the stage below it.
  for (let round = 0; round < 2; round++) {
    let acc = 0;
    for (let j = 0; j <= HAND; j++) {
      acc += exactly(j, size, HAND, DECK) * (keep.has(j) ? afterKeep(j, j) : stage);
    }
    stage = acc;
  }
  return stage;
}

/** P(the deck makes its first `need` land drops), under the owner's policy.
 *
 *  `need` lands among the kept hand plus `need` draws IS hitting every drop in order, not merely the
 *  last one: a player gains at most one land per turn, so `landsSeen(need) >= need` forces
 *  `landsSeen(k) >= k` at every earlier k. No overstatement hides in the aggregate.
 *
 *  The deadline for N land drops IS turn N, which is why this is `pByTurn` on its own diagonal. */
export function pLandDrops(lands: number, need = 3, keep: ReadonlySet<number> = STANDARD_KEEP): number {
  return pByTurn(lands, need, need, keep);
}

/** The fewest sources of a category reaching `confidence` on having `need` of them by `turn` -- the
 *  mulligan-corrected counterpart of `minCopies`, which computes the same quantity raw.
 *
 *  Returns `undefined` rather than a number when no count in the deck gets there, for the same
 *  reason `landsForDrops` does: a silent 99 would read as advice. */
export function minSources(
  need: number, turn: number, confidence = 0.9, keep: ReadonlySet<number> = STANDARD_KEEP,
): number | undefined {
  for (let s = 1; s <= DECK; s++) if (pByTurn(s, need, turn, keep) >= confidence) return s;
  return undefined;
}

/** The fewest lands reaching `confidence` on the first `need` land drops under this policy -- the
 *  first-principles land target, replacing "36 lands is the convention".
 *
 *  Returns `undefined` rather than a number when no count in the search range gets there, because a
 *  silent 45 would read as advice. */
export function landsForDrops(
  need = 3,
  confidence = 0.9,
  keep: ReadonlySet<number> = STANDARD_KEEP,
  max = 60,
): number | undefined {
  for (let l = 1; l <= max; l++) if (pLandDrops(l, need, keep) >= confidence) return l;
  return undefined;
}

/** THE JOINT COUNTERPART OF `pByTurn` (#1116 review): P(by `turn`, the sources held can pay a multicolour cost), under the
 *  same policy -- keep a seven-card hand on `keep` SOURCES of the cost's colours (the union), a free mulligan, then the
 *  forced six -- so a gold finding is held to the frame the per-colour rows are. With one colour it IS `pByTurn`
 *  (the consistency test), whose `DECK` is 99; here the library is the sum of the class sizes.
 *
 *  `classSizes[m]` is the library cards of membership class `m`, a bitmask over the `need.length` colours (0 = none of
 *  them); `need[i]` is pips of colour i. A kept hand is split exactly over the classes, and the draw is `pCanPay` with
 *  the hand as its offset, over the cards never drawn (`REACHABLE`: the bottomed card is under everything).
 *
 *  CEILING: the same land-band caveat as `pByTurn` -- an UPPER bound on the mulligan's help. The forced six bottoms a
 *  spell, or from a hand of five-plus sources one of the class the hand holds most of (fewest colours on a tie), where
 *  a player would pick by what the hand still needs. */
export function pCanPayByTurn(
  classSizes: readonly number[], need: readonly number[], turn: number, keep: ReadonlySet<number> = STANDARD_KEEP,
): number {
  const L = classSizes.reduce((a, b) => a + b, 0);
  const draws = seen(turn) - HAND;
  const classes = classSizes.length;
  const bits = (m: number): number => { let c = 0; for (; m; m >>= 1) c += m & 1; return c; };
  const hands: { weight: number; keep: number; forced: number; sources: number }[] = [];
  const hand = new Array<number>(classes).fill(0);
  const payAfter = (h: readonly number[], bottom: number): number => {
    const inHand = h.slice();
    if (bottom >= 0) inHand[bottom]!--;
    const pool = classSizes.map((s, m) => s - h[m]!);
    return pCanPay(pool, need, draws, L - HAND, inHand);
  };
  const walk = (m: number, left: number, weight: number): void => {
    if (m === classes - 1) {
      if (left > classSizes[m]!) return;
      hand[m] = left;
      const w = (weight * comb(classSizes[m]!, left)) / comb(L, HAND);
      const sources = hand.reduce((a, x, i) => (i > 0 ? a + x : a), 0);
      // The forced six bottoms a spell (a class-0 card) unless the hand holds five or more sources.
      let bottom = 0;
      if (sources >= 5) {
        bottom = -1;
        for (let i = 1; i < classes; i++) {
          if (hand[i]! > 0 && (bottom < 0 || hand[i]! > hand[bottom]! || (hand[i]! === hand[bottom]! && bits(i) < bits(bottom)))) bottom = i;
        }
      }
      hands.push({ weight: w, keep: keep.has(sources) ? payAfter(hand, -1) : -1, forced: payAfter(hand, bottom), sources });
      return;
    }
    for (let x = 0; x <= Math.min(left, classSizes[m]!); x++) {
      hand[m] = x;
      walk(m + 1, left - x, weight * comb(classSizes[m]!, x));
    }
  };
  walk(0, HAND, 1);
  let stage = hands.reduce((a, h) => a + h.weight * h.forced, 0);
  for (let round = 0; round < 2; round++) {
    stage = hands.reduce((a, h) => a + h.weight * (h.keep >= 0 ? h.keep : stage), 0);
  }
  return Math.min(stage, 1);
}
