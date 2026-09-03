import { expect, test } from "vitest";
import { MIN_DISC_PX, OPEN_DISC_PX, predictDiscDiameter } from "./disc-fit.js";

test("the constants are the house target sizes", () => {
  expect(MIN_DISC_PX).toBe(24);
  expect(OPEN_DISC_PX).toBe(44);
});

// THE ANCHOR, MEASURED IN A REAL BROWSER 2026-09-03: the example deck's 73 nodes in a 324x378
// canvas at a 390px viewport fit at z=0.524, drawing 14.7px discs. The model has to reproduce the
// one point it was calibrated on, or it is not a model of this board.
test("reproduces the measured anchor within half a pixel", () => {
  expect(predictDiscDiameter(73, 324, 378)).toBeCloseTo(14.7, 0);
});

test("fewer nodes in the same canvas draw bigger discs", () => {
  expect(predictDiscDiameter(13, 324, 378)).toBeGreaterThan(predictDiscDiameter(73, 324, 378));
});

test("the limiting dimension is the smaller one, so a wide short canvas is sized by its height", () => {
  expect(predictDiscDiameter(20, 1200, 300)).toBeCloseTo(predictDiscDiameter(20, 300, 300), 5);
});

// The whole-deck board on a phone is not merely worse, it is unreachable: no real deck clears the
// floor. This is the assertion that fails loudly if someone tries to bring the cloud back.
test("a real deck's whole board cannot clear the 24px floor at phone width", () => {
  for (const n of [73, 90, 100]) {
    expect(predictDiscDiameter(n, 374, 600)).toBeLessThan(MIN_DISC_PX);
  }
});

// DELETED RATHER THAN RE-ANCHORED, and the deletion is the finding. This asserted that the model
// predicts a comfortable depth-1 ego view, which it does -- but the model does not describe small
// graphs at all. Measured 2026-09-03 across three widths and five focus cards, the implied spread
// constant varies 2.1x (52.9 to 112.7) and not with node count: 5 nodes span 252 world units where
// 8 span 150, because `linkDistanceFor` is weight-dependent. A test that passes on a model known
// not to apply is worse than no test. The real ego sizes are measured in the browser and recorded
// in `disc-fit.ts`; the smallest observed was 27.2px, above the floor at every width.
// (No replacement test. The scoping is a fact about where the model applies, not a behaviour, and a
// test that asserted the comment text would be noise pretending to be evidence.)

test("an empty or single-node view is not a division by zero", () => {
  expect(Number.isFinite(predictDiscDiameter(0, 374, 600))).toBe(true);
  expect(Number.isFinite(predictDiscDiameter(1, 374, 600))).toBe(true);
});
