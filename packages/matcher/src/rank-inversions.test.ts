import { expect, test } from "vitest";
import { countInversions, diffInversions, ratingsFor } from "./rank-inversions.js";
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
  // The `headline` map is deliberately DISTINCT from both `feeder` (which is byte-identical to it
  // in the previous version of this fixture) and from `payoff`'s own value for "payoff" — a bug
  // reading `ratings.headline` where it should read `ratings.feeder` or `ratings.payoff` must fail
  // this assertion rather than pass on a coincidentally-matching fixture.
  const r = ratings(
    [["payoff", 2], ["quiet", 1], ["a", 0], ["b", 0], ["c", 0], ["d", 0]],
    [["a", 4], ["b", 3], ["c", 1], ["d", 5], ["payoff", 0], ["quiet", 0]],
    [["payoff", 3], ["quiet", 1], ["a", 0], ["b", 0], ["c", 0], ["d", 0]],
    ["payoff", "quiet"],
  );
  const report = countInversions(rows, r, { glut: 3 });
  expect(report.shapes).toBe(1);
  expect(report.inversions).toBe(2);   // a and b outrank the payoff; c does not
  expect(report.payoffs).toEqual([
    { tag: "enters:creature", name: "payoff", rating: 2, headline: 3, protectedPayoff: true, feedersAbove: 2 },
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
 *  under a discount-only term, so gating on it would be a gate that cannot fire.
 *  `protectedPayoff` flips between BEFORE and AFTER on the `payoff` row (true -> false) so the test
 *  cannot pass on a bug that reads either snapshot's flag interchangeably — the split must use the
 *  BEFORE row's classification, since that is the set the gate is protecting. */
test("the diff splits headline falls into the protected set and the rest, keyed on the BEFORE flag", () => {
  const mk = (rating: number, headline: number, protectedPayoff: boolean, feedersAbove: number) =>
    ({ tag: "t", name: "payoff", rating, headline, protectedPayoff, feedersAbove });
  const before = { shapes: 1, inversions: 5, payoffs: [mk(2, 3, true, 5), { ...mk(1, 2, false, 3), name: "enabler" }], unmeasurablePayoffs: 0, unmeasurableFeederPairs: 0 };
  const after  = { shapes: 1, inversions: 1, payoffs: [mk(2, 2.8, false, 1), { ...mk(1, 1.5, false, 1), name: "enabler" }], unmeasurablePayoffs: 0, unmeasurableFeederPairs: 0 };
  const d = diffInversions(before, after);
  expect(d.inversionsBefore).toBe(5);
  expect(d.inversionsAfter).toBe(1);
  expect(d.headlineFallenProtected).toEqual([{ tag: "t", name: "payoff", from: 3, to: 2.8 }]);
  expect(d.headlineFallenOther).toEqual([{ tag: "t", name: "enabler", from: 2, to: 1.5 }]);
});

/** Important 1: a snapshot taken before the per-role fields existed has no `headline`/
 *  `protectedPayoff` on its rows. Diffing against one must refuse rather than silently read
 *  `undefined` on both sides and print a false "clears" on the ship gate. */
test("diffing against a pre-per-role snapshot throws instead of silently passing", () => {
  const staleRow = { tag: "t", name: "payoff", rating: 2, feedersAbove: 5 } as unknown as {
    tag: string; name: string; rating: number; headline: number; protectedPayoff: boolean; feedersAbove: number;
  };
  const stale = { shapes: 1, inversions: 5, payoffs: [staleRow], unmeasurablePayoffs: 0, unmeasurableFeederPairs: 0 };
  const fresh = { shapes: 1, inversions: 1, payoffs: [{ tag: "t", name: "payoff", rating: 2, headline: 2.8, protectedPayoff: true, feedersAbove: 1 }], unmeasurablePayoffs: 0, unmeasurableFeederPairs: 0 };
  expect(() => diffInversions(stale, fresh)).toThrow(/per-role/);
  expect(() => diffInversions(fresh, stale)).toThrow(/per-role/);
});

/** THE FACE FOLD. `report.cards` is one row per printed FACE; every key `countInversions` looks up
 *  is a PHYSICAL card name. The whole row is chosen once, on `score`, so the four facts a payoff is
 *  judged by can never come from two different faces. */
test("a two-faced card folds to ONE row -- the stronger face -- and all four facts come from it", () => {
  const r = ratingsFor([
    { name: "Solo", score: 1, authority: 0.9, synergyRating: 1.1, payoffRating: 1.2, feederRating: 0.3 },
    // The front is weaker and majority-PAYOFF. A per-field fold would take protection from here and
    // the headline from the back face -- one card judged by two rows.
    { name: "Fell the Profane", cardName: "F // M", score: 1, authority: 0.9, synergyRating: 2, payoffRating: 3, feederRating: 0.1 },
    // The BACK face is the stronger half: higher score, and it is majority-FEEDER (2*0.2 < 1.8).
    { name: "Fell Mire", cardName: "F // M", score: 1.8, authority: 0.2, synergyRating: 4, payoffRating: 0.5, feederRating: 4.5 },
  ]);
  expect(r.headline.get("F // M")).toBe(4);
  expect(r.payoff.get("F // M")).toBe(0.5); // the back face's, NOT the front's higher 3
  expect(r.feeder.get("F // M")).toBe(4.5);
  expect(r.majorityPayoff.has("F // M")).toBe(false); // the chosen row's classification, not an OR
  // A single-faced card is untouched, and a missing rating stays MISSING rather than becoming 0.
  expect(r.headline.get("Solo")).toBe(1.1);
  expect(r.majorityPayoff.has("Solo")).toBe(true);
  expect(r.payoff.has("nobody")).toBe(false);
});

/** Absent `authority` means NOT CLASSIFIED. Defaulting it to 0 would make `0 >= 0` true and put
 *  every unmeasured card into the protected set, which is the gate failing open. */
test("a row with no authority is not protected, and ties break on name so the fold is deterministic", () => {
  const r = ratingsFor([
    { name: "Unmeasured", score: 2, synergyRating: 2 },
    { name: "B face", cardName: "A // B", score: 1, authority: 1, synergyRating: 2 },
    { name: "A face", cardName: "A // B", score: 1, authority: 0.1, synergyRating: 3 },
  ]);
  expect(r.majorityPayoff.has("Unmeasured")).toBe(false);
  // Equal scores -> the alphabetically first name wins, whatever order the rows arrived in.
  expect(r.headline.get("A // B")).toBe(3);
});
