import { expect, test } from "vitest";
import { countInversions, diffInversions } from "./rank-inversions.js";
import type { SupplyDemandRow } from "./supply-demand.js";

const side = (names: string[], avail: number) =>
  ({ cards: names.length, rate: avail, avail, commander: false, refused: 0, tokens: 0, labels: {}, names });

const row = (key: string, supply: string[], supplyAvail: number, demand: string[], demandAvail: number): SupplyDemandRow =>
  ({ key, reasons: supply.length * demand.length, supply: side(supply, supplyAvail), demand: side(demand, demandAvail) });

/** The witness shape: a scarce payoff fed by many marginal suppliers. Every supplier rated above
 *  the payoff is one inversion — the engine saying the 30th body matters more than the card that
 *  turns bodies into cards. */
test("counts feeders rated above the payoff they feed, in glutted shapes only", () => {
  const rows = [
    row("enters:creature", ["a", "b", "c"], 30, ["payoff"], 1),
    row("dies:creature", ["d"], 1, ["quiet"], 1), // ratio 1, below the glut threshold
  ];
  const ratings = new Map([["a", 4], ["b", 3], ["c", 1], ["payoff", 2], ["d", 5], ["quiet", 1]]);
  const report = countInversions(rows, ratings, { glut: 3 });
  expect(report.shapes).toBe(1);          // only the glutted row is examined
  expect(report.inversions).toBe(2);      // a and b outrank payoff; c does not
  expect(report.payoffs).toEqual([{ tag: "enters:creature", name: "payoff", rating: 2, feedersAbove: 2 }]);
});

/** Both halves of the acceptance criterion have to be readable from one comparison: inversions
 *  must FALL, and no scarce payoff may LOSE rating. A pass on the first with a fall on the second
 *  is the failure this exists to catch. */
test("the diff reports inversions moved and payoffs whose rating fell", () => {
  const before = { shapes: 1, inversions: 5, payoffs: [{ tag: "t", name: "payoff", rating: 2, feedersAbove: 5 }], unmeasurablePayoffs: 0, unmeasurableFeeders: 0 };
  const after = { shapes: 1, inversions: 1, payoffs: [{ tag: "t", name: "payoff", rating: 1.5, feedersAbove: 1 }], unmeasurablePayoffs: 0, unmeasurableFeeders: 0 };
  const d = diffInversions(before, after);
  expect(d.inversionsBefore).toBe(5);
  expect(d.inversionsAfter).toBe(1);
  expect(d.payoffsFallen).toEqual([{ tag: "t", name: "payoff", from: 2, to: 1.5 }]);
});

/** A payoff or feeder ABSENT from the ratings map is a token node — the ratings pass never reads
 *  one — and is UNMEASURABLE, not zero-rated. Defaulting it to 0 would manufacture an inversion
 *  against every real feeder (the payoff case) or make a real feeder unable to invert against
 *  anything (the feeder case). A genuine rating of 0 is a real measured value and must still
 *  count normally — the two must not collapse into one behaviour. */
test("a payoff or feeder missing from the ratings map is unmeasurable, not rated zero", () => {
  const rows = [
    // "zero" is a REAL card genuinely rated 0: still counts inversions against it.
    row("enters:creature", ["a"], 30, ["zero"], 1),
    // "Token" is absent from the ratings map entirely: unmeasurable, not zero.
    row("enters:artifact", ["b"], 30, ["Token"], 1),
    // an absent FEEDER is likewise skipped rather than treated as rating 0.
    row("cast:spell", ["Elemental", "c"], 30, ["payoff"], 1),
  ];
  const ratings = new Map([["a", 1], ["zero", 0], ["b", 2], ["c", 0], ["payoff", 1]]);
  const report = countInversions(rows, ratings, { glut: 3 });
  expect(report.shapes).toBe(3);
  // "zero" genuinely rated 0: "a" (rating 1) outranks it, a real inversion.
  expect(report.payoffs).toContainEqual({ tag: "enters:creature", name: "zero", rating: 0, feedersAbove: 1 });
  // "Token" has no entry at all: excluded from payoffs and counted separately.
  expect(report.payoffs.some((p) => p.name === "Token")).toBe(false);
  expect(report.unmeasurablePayoffs).toBe(1);
  // "Elemental" (unmeasurable feeder) does not count toward feedersAbove against "payoff".
  expect(report.payoffs).toContainEqual({ tag: "cast:spell", name: "payoff", rating: 1, feedersAbove: 0 });
  expect(report.unmeasurableFeeders).toBe(1);
  expect(report.inversions).toBe(1);
});
