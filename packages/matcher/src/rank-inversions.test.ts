import { expect, test } from "vitest";
import { countInversions, diffInversions } from "./rank-inversions.js";
import type { SupplyDemandRow } from "./supply-demand.js";

const side = (names: string[], avail: number) =>
  ({ cards: names.length, rate: avail, avail, commander: false, refused: 0, tokens: 0, labels: {}, names });

const row = (key: string, supply: string[], supplyAvail: number, demand: string[], demandAvail: number): SupplyDemandRow =>
  ({ key, reasons: supply.length * demand.length, supply: side(supply, supplyAvail), demand: side(demand, demandAvail) });

const ratings = (
  payoff: [string, number][],
  feeder: [string, number][],
  headline: [string, number][],
  majorityPayoff: string[],
) => ({
  payoff: new Map(payoff), feeder: new Map(feeder), headline: new Map(headline),
  majorityPayoff: new Set(majorityPayoff),
});

/** The witness shape: a scarce payoff fed by many marginal suppliers. A feeder is judged on what it
 *  earns AS A FEEDER and the payoff on what it earns AS A PAYOFF — like with like, which the single
 *  blended rating could not do. */
test("counts feeders whose feeder rating beats the payoff's payoff rating, in glutted shapes only", () => {
  const rows = [
    row("enters:creature", ["a", "b", "c"], 30, ["payoff"], 1),
    row("dies:creature", ["d"], 1, ["quiet"], 1), // ratio 1, below the glut threshold
  ];
  const r = ratings(
    [["payoff", 2], ["quiet", 1], ["a", 0], ["b", 0], ["c", 0], ["d", 0]],
    [["a", 4], ["b", 3], ["c", 1], ["d", 5], ["payoff", 0], ["quiet", 0]],
    [["payoff", 2], ["quiet", 1], ["a", 4], ["b", 3], ["c", 1], ["d", 5]],
    ["payoff", "quiet"],
  );
  const report = countInversions(rows, r, { glut: 3 });
  expect(report.shapes).toBe(1);
  expect(report.inversions).toBe(2);   // a and b outrank the payoff; c does not
  expect(report.payoffs).toEqual([
    { tag: "enters:creature", name: "payoff", rating: 2, headline: 2, protectedPayoff: true, feedersAbove: 2 },
  ]);
});

/** A name absent from a role map is UNMEASURABLE, never zero — the `?? 0` shape the final-review
 *  fix wave removed for tokens. Scoring an absent card 0 manufactures an inversion against every
 *  real feeder. */
test("a payoff or feeder missing from its role map is unmeasurable, not zero-rated", () => {
  const rows = [row("enters:creature", ["a", "ghost"], 30, ["payoff", "phantom"], 1)];
  const r = ratings([["payoff", 2]], [["a", 4]], [["payoff", 2], ["a", 4]], ["payoff"]);
  const report = countInversions(rows, r, { glut: 3 });
  expect(report.unmeasurablePayoffs).toBe(1);      // `phantom` has no payoff rating
  expect(report.unmeasurableFeederPairs).toBe(1);  // `ghost` compared against `payoff` once
  expect(report.inversions).toBe(1);               // only a-vs-payoff was measurable
});

/** Part 2 of the re-registered criterion (spec §4.2): the HEADLINE is what the product shows and
 *  what the gate reads, split by whether the payoff is majority-payoff. `payoffRating` cannot fall
 *  under a discount-only term, so gating on it would be a gate that cannot fire. */
test("the diff splits headline falls into the protected set and the rest", () => {
  const mk = (rating: number, headline: number, protectedPayoff: boolean, feedersAbove: number) =>
    ({ tag: "t", name: "payoff", rating, headline, protectedPayoff, feedersAbove });
  const before = { shapes: 1, inversions: 5, payoffs: [mk(2, 3, true, 5), { ...mk(1, 2, false, 3), name: "enabler" }], unmeasurablePayoffs: 0, unmeasurableFeederPairs: 0 };
  const after  = { shapes: 1, inversions: 1, payoffs: [mk(2, 2.8, true, 1), { ...mk(1, 1.5, false, 1), name: "enabler" }], unmeasurablePayoffs: 0, unmeasurableFeederPairs: 0 };
  const d = diffInversions(before, after);
  expect(d.inversionsBefore).toBe(5);
  expect(d.inversionsAfter).toBe(1);
  expect(d.headlineFallenProtected).toEqual([{ tag: "t", name: "payoff", from: 3, to: 2.8 }]);
  expect(d.headlineFallenOther).toEqual([{ tag: "t", name: "enabler", from: 2, to: 1.5 }]);
});
