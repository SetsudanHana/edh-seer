import { describe, expect, test } from "vitest";
import { comb, jointAvailability, minCopies, pAtLeast, seen } from "./hypergeometric.js";

/** The external spec's §9 acceptance values, plus every other Tier A number in that document that
 *  these four functions can produce.
 *
 *  RECOMPUTED FIRST, 2026-08-11, from the spec's own §1 Python transcribed verbatim: 41 assertions
 *  in §9/§2.1/§3.3/§5.2, §3.1's 21-cell table and §3.2's 109-card sentence all reproduce exactly.
 *  That mattered because the deck-math stub §9 told us to distrust them -- the document kills
 *  scrollvault.net on arithmetic, so the same test had to be turned on the document. It passes.
 *  These are therefore acceptance tests against a verified oracle, not transcription. */
describe("the spec's acceptance values", () => {
  const pct = (p: number) => Math.round(p * 1000) / 10;

  test("pAtLeast on the three primitive cases", () => {
    expect(Math.round(pAtLeast(3, 36, seen(3)) * 1e4) / 1e4).toBe(0.7805); // 3 lands by T3, 36 lands
    expect(pct(pAtLeast(1, 7, 7))).toBe(41.2);      // a 7-of in 99, opening hand
    expect(pct(pAtLeast(1, 4, 7, 60))).toBe(39.9);  // a 4-of in 60 -- the 7x9 premise
  });

  /** The document's own falsifier: scrollvault.net claims 90.3% for a 6-drop on T6 at 37 lands.
   *  Keeping it as a test keeps the ceiling that catches that whole class of source. */
  test("the hard ceiling that falsifies bad sources", () => {
    expect(pct(pAtLeast(6, 37, seen(6)))).toBe(34.1); // NOT 90.3
  });

  test("minCopies", () => {
    expect(minCopies(1, 4, 0.9)).toBe(18);
    expect(minCopies(1, 3, 0.9)).toBe(20);
    expect(minCopies(2, 2, 0.9)).toBe(36);
    expect(minCopies(3, 3, 0.9)).toBe(44);
  });

  /** §3.1's table, all 21 cells. The spec presents it as Tier A, and it is the table every
   *  category target is read off, so it is worth more than the four spot checks above. */
  test("the §3.1 copies-needed table at 90%", () => {
    const turns = [2, 3, 4, 5, 6, 8, 10];
    const rows: Record<number, number[]> = {
      1: [22, 20, 18, 17, 16, 14, 12],
      2: [36, 33, 30, 28, 26, 23, 20],
      3: [48, 44, 40, 38, 35, 31, 27],
    };
    for (const [k, expected] of Object.entries(rows)) {
      expect(turns.map((t) => minCopies(Number(k), t, 0.9))).toEqual(expected);
    }
  });

  test("jointAvailability at turn 5", () => {
    const n5 = seen(5);
    expect(pct(jointAvailability([14, 14, 14], n5))).toBe(61.4);
    expect(pct(jointAvailability([27, 3, 12], n5))).toBe(24.8);
    expect(pct(jointAvailability([20, 6, 12], n5))).toBe(40.3);
    expect(pct(jointAvailability([17, 9, 12], n5))).toBe(49.9);
  });

  /** §5.2's recommendation engine is just deltas of jointAvailability, and its whole claim is the
   *  ORDERING plus the ten-to-one spread. A sign error or an off-by-one in the loop would still
   *  produce three plausible percentages, so the ordering is asserted, not just the numbers. */
  test("the §5.2 marginal-value table -- 20 makers / 6 outlets / 12 payoffs at T5", () => {
    const n5 = seen(5);
    const support = [20, 6, 12];
    const base = jointAvailability(support, n5);
    expect(pct(base)).toBe(40.3);

    const bump = (i: number) => {
      const b = [...support];
      b[i] += 1;
      return jointAvailability(b, n5);
    };
    expect(pct(bump(1))).toBe(44.7); // +1 sac outlet
    expect(pct(bump(2))).toBe(41.7); // +1 payoff
    expect(pct(bump(0))).toBe(40.7); // +1 token maker

    const deltas = [0, 1, 2].map((i) => bump(i) - base);
    expect(Math.round((deltas[1] - 0) * 1e4) / 100).toBe(4.39); // the top add, in points
    expect(deltas[1]).toBeGreaterThan(deltas[2]);
    expect(deltas[2]).toBeGreaterThan(deltas[0]);
    // The claim that makes this the recommendation engine: ten-to-one between best and worst slot.
    expect(deltas[1] / deltas[0]).toBeGreaterThan(9);
  });

  /** §5.3: rebalancing at CONSTANT deck size, 20/6/12 -> 17/9/12. The most satisfying output the
   *  tool can produce, per the spec, and it is a property of these functions alone. */
  test("the §5.3 free improvement -- same 38 cards, nine points better", () => {
    const n5 = seen(5);
    expect(pct(jointAvailability([20, 6, 12], n5))).toBe(40.3);
    expect(pct(jointAvailability([17, 9, 12], n5))).toBe(49.9);
  });

  /** §3.4's templates are all one-liners over pAtLeast, and they are the reason 7 is called "the
   *  singleton playset". */
  test("the §3.4 template confidences at T4", () => {
    expect(Math.round(pAtLeast(1, 7, seen(4)) * 100)).toBe(57);  // 7x9
    expect(Math.round(pAtLeast(1, 8, seen(4)) * 100)).toBe(62);  // 8x8
    expect(Math.round(pAtLeast(1, 10, seen(4)) * 100)).toBe(71); // Command Zone
  });

  /** The spec's argument against uniform templates, in two numbers: at the same confidence, a T2
   *  category needs nearly twice what a T9 one does. */
  test("uniform templates under-supply early categories", () => {
    expect(minCopies(1, 2, 0.75)).toBe(14); // ramp, T2
    expect(minCopies(1, 9, 0.75)).toBe(8);  // finisher, T9
  });

  /** §3.2's central design fact: the default targets at 90% do not fit in a deck. */
  test("the §3.2 overdetermination arithmetic", () => {
    const lands = 37;
    const ramp = minCopies(1, 3, 0.9);
    const draw = minCopies(1, 4, 0.9);
    const removal = minCopies(1, 4, 0.9);
    const wipe = minCopies(1, 6, 0.9);
    expect([ramp, draw, removal, wipe]).toEqual([20, 18, 18, 16]);
    expect(lands + ramp + draw + removal + wipe).toBe(109); // ten over budget, before any strategy
  });
});

describe("edges the spec's Python gets for free and TypeScript does not", () => {
  test("comb is exact at the sizes this deck math uses", () => {
    // Turn 5 draws 12 of 99. The multiplicative running product lands this exactly, where 99!
    // as a factorial ratio would be Infinity/Infinity long before here.
    expect(comb(99, 12)).toBe(924370524973896);
    expect(Number.isSafeInteger(comb(99, 12))).toBe(true);
    expect(comb(5, 0)).toBe(1);
    expect(comb(5, 5)).toBe(1);
    expect(comb(5, 6)).toBe(0);
    expect(comb(5, -1)).toBe(0);
  });

  test("pAtLeast(0, ...) is 1 -- you always draw at least none of them", () => {
    // Pins the i=0 term of the sum. Without it, clamping the loop's start to 1 silently turns
    // every "at least 0" question into "at least 1", and P(>=0) is the denominator a caller
    // reaches for when normalising a distribution.
    expect(pAtLeast(0, 10, 12)).toBe(1);
    expect(pAtLeast(0, 0, 12)).toBe(1);
  });

  test("pAtLeast is 1 when every draw must succeed, 0 when none can", () => {
    expect(pAtLeast(1, 99, 7)).toBe(1);   // every card is a success
    expect(pAtLeast(1, 0, 7)).toBe(0);    // none are
    expect(pAtLeast(8, 7, 7)).toBe(0);    // want more than exist
    expect(pAtLeast(8, 40, 7)).toBe(0);   // want more than you draw
  });

  test("pAtLeast is monotone in copies and in cards seen", () => {
    const more = [10, 11, 12, 13].map((s) => pAtLeast(1, s, 12));
    expect([...more].sort((a, b) => a - b)).toEqual(more);
    const later = [2, 3, 4, 5].map((t) => pAtLeast(1, 10, seen(t)));
    expect([...later].sort((a, b) => a - b)).toEqual(later);
  });

  test("minCopies throws rather than returning a wrong count it cannot reach", () => {
    // 99 copies of a card still cannot give you 8 of them in a 7-card opener. A silent 99 would
    // read as "play the whole deck as ramp" instead of "this question has no answer".
    expect(() => minCopies(8, 0, 0.9)).toThrow(/unreachable/i);
  });

  test("jointAvailability with one group is just pAtLeast(1)", () => {
    expect(jointAvailability([14], seen(5))).toBeCloseTo(pAtLeast(1, 14, seen(5)), 12);
  });

  test("jointAvailability is 1 for no groups at all", () => {
    // The empty product. Falls out of the inclusion-exclusion, and asserting it pins the r=0 term.
    expect(jointAvailability([], seen(5))).toBe(1);
  });

  test("jointAvailability never exceeds its own weakest group", () => {
    const n = seen(5);
    const groups = [20, 6, 12];
    const weakest = Math.min(...groups.map((g) => pAtLeast(1, g, n)));
    expect(jointAvailability(groups, n)).toBeLessThanOrEqual(weakest);
  });

  /** The caveat the deck-math stub §9 insists must ride along with every number this produces:
   *  the groups are assumed DISJOINT, and our build categories overlap on purpose. Asserted here
   *  so the assumption is visible in the tests and not only in prose -- a call whose groups sum
   *  past the library is nonsense, and it says so. */
  test("jointAvailability rejects groups that cannot be disjoint", () => {
    expect(() => jointAvailability([50, 50, 50], seen(5))).toThrow(/disjoint|exceed/i);
  });
});
