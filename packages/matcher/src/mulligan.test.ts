import { describe, expect, it } from "vitest";
import { pAtLeast } from "@mtg/engine";
import { landsForDrops, pLandDrops, STANDARD_KEEP } from "./mulligan.js";

describe("mulligan policy", () => {
  // Every figure below was cross-checked against a 400,000-trial Monte Carlo (a different method,
  // because re-running a derivation cannot reveal a systematic error in it): 37 lands on the
  // standard band reads 0.9036 +/- 0.0009 there against 0.9029 here.
  it("prices the free mulligan at 10 points on the three-drop question", () => {
    expect(pAtLeast(3, 37, 10, 99)).toBeCloseTo(0.8004, 4); // no mulligan, the old figure
    expect(pLandDrops(37)).toBeCloseTo(0.9029, 4);           // the owner's policy
  });

  it("says 37 lands really does hit three land drops ~90% of the time", () => {
    // The claim this repo published as refuted on 2026-08-23 and then had to withdraw. It is
    // correct, and the whole module exists because it was called false against a model missing a
    // term.
    expect(pLandDrops(37)).toBeGreaterThan(0.9);
    expect(pLandDrops(36)).toBeLessThan(0.9);
  });

  it("lands the target inside the community band under every keep rule a player uses", () => {
    // THE RESULT THAT MATTERS: L* moves by at most one land across realistic bands, so the keep
    // policy is a reported sensitivity rather than a blocker on the whole question.
    expect(landsForDrops(3, 0.9, STANDARD_KEEP)).toBe(37);
    expect(landsForDrops(3, 0.9, new Set([2, 3, 4, 5]))).toBe(36);
    // And it escapes the band only under rules that are not play: mulliganing every four-land hand,
    // or keeping one-landers.
    expect(landsForDrops(3, 0.9, new Set([2, 3]))).toBe(41);
    expect(landsForDrops(3, 0.9, new Set([1, 2, 3, 4, 5]))).toBe(43);
  });

  it("is monotone in lands", () => {
    // Cheap invariant, and it would fire on an off-by-one in the reachable-pool arithmetic, which
    // is the one place the bottoming derivation could go quietly wrong.
    for (let l = 20; l < 45; l++) expect(pLandDrops(l + 1)).toBeGreaterThan(pLandDrops(l));
  });

  it("refuses rather than guessing when no land count reaches the confidence", () => {
    expect(landsForDrops(3, 0.999)).toBeUndefined();
  });
});

/** THE RATCHET UNDER L1's REFUSAL (spec §10.1). `landsForDrops` takes no deck argument, so the
 *  "first-principles per-deck land target" it was proposed for cannot vary across decks except
 *  through `need` — and the step is twelve lands wide, so either every deck's target is 37 (and a
 *  constant scores a perfect zero against it) or it is a count no Commander deck runs.
 *
 *  If someone makes this function deck-aware, these fail and the refusal is due a re-read. */
describe("landsForDrops is not a per-deck quantity — L1's refusal", () => {
  it("varies only through `need`, and three drops at 90% is exactly the conventional 37", () => {
    expect(landsForDrops(3, 0.9)).toBe(37);
  });

  it("steps to a count no Commander deck runs the moment a fourth drop is asked for", () => {
    expect(landsForDrops(4, 0.9)).toBe(49);
    expect(landsForDrops(5, 0.9)).toBe(56);
  });

  it("moves by at most one land across the keep bands a real player uses", () => {
    const bands = [STANDARD_KEEP, new Set([2, 3, 4, 5]), new Set([2, 3, 4, 5, 6])];
    const answers = bands.map((k) => landsForDrops(3, 0.9, k)!);
    expect(Math.max(...answers) - Math.min(...answers)).toBeLessThanOrEqual(1);
  });
});
