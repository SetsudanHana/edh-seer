// @vitest-environment node
//
// The tagger and matcher packages both eagerly readFileSync(new URL(..., import.meta.url))
// at import time; fine under node, but under jsdom import.meta.url does not resolve to a
// file: URL and the read throws.

import { expect, test } from "vitest";
import { floorState, bandState, scoreState } from "./deck-gauge.js";

/** THE FLOOR DIAL IS ASYMMETRIC ON PURPOSE, and it is derived rather than styled: `build.ts:517`
 *  reads `Math.min(p.count / p.target, 1) // exceeding a floor never penalizes`. Interaction 19
 *  against a target of 10 is FULL CREDIT, and the trim chips call the same +9 "where the room is".
 *  A dial reddening the over side would contradict buildScore and the cut list on one screen. */
test("the floor dial reds only the under side", () => {
  expect(floorState(7, 10).state).toBe("far-under");
  expect(floorState(7, 10).tone).toBe("danger");
  expect(floorState(8, 10).state).toBe("under");
  expect(floorState(9, 10).tone).toBe("warning");
  expect(floorState(10, 10).state).toBe("on-target");
  expect(floorState(12, 10).state).toBe("on-target");
  expect(floorState(12, 10).tone).toBe("success");
  expect(floorState(13, 10).state).toBe("room");
  expect(floorState(19, 10).tone).toBe("neutral");
});

test("the floor dial says the distance in words, never colour alone", () => {
  expect(floorState(19, 10).label).toBe("9 over target");
  expect(floorState(8, 10).label).toBe("2 short");
  expect(floorState(9, 10).label).toBe("1 short");
  expect(floorState(10, 10).label).toBe("on target");
});

/** Lands is the one genuinely two-sided gauge -- over is wrong here too -- and its tolerance is
 *  the engine's own LAND_BAND (3) and LAND_FALLOFF (9), imported rather than copied. */
test("the lands dial is two-sided on the engine's own band", () => {
  expect(bandState(36, 36).state).toBe("on-band");
  expect(bandState(38, 36).state).toBe("on-band");
  expect(bandState(39, 36).state).toBe("on-band");
  expect(bandState(40, 36).state).toBe("over");
  expect(bandState(40, 36).tone).toBe("warning");
  expect(bandState(33, 36).state).toBe("on-band");
  expect(bandState(32, 36).state).toBe("under");
  expect(bandState(48, 36).state).toBe("far-over");
  expect(bandState(48, 36).tone).toBe("danger");
  expect(bandState(24, 36).state).toBe("far-under");
});

test("the lands dial names the direction", () => {
  expect(bandState(40, 36).label).toBe("4 over");
  expect(bandState(32, 36).label).toBe("4 under");
  expect(bandState(36, 36).label).toBe("on the modelled count");
});

/** A score has a ceiling, not a floor, so it never has an over state -- and synergy loses its
 *  judgement on a partly-read deck, the rule HeadlineScores already enforces: synergyOverall is
 *  edge-derived, so on a deck where half the cards form no edge by construction a red 0.8/5
 *  renders the engine's blindness as the player's failure. The number still shows. */
test("the score dial uses the product's own four bands", () => {
  expect(scoreState(0.8).state).toBe("unfocused");
  expect(scoreState(0.8).tone).toBe("danger");
  expect(scoreState(2).state).toBe("developing");
  expect(scoreState(2).tone).toBe("warning");
  expect(scoreState(3.4).state).toBe("focused");
  expect(scoreState(3.4).tone).toBe("success");
  expect(scoreState(4.5).state).toBe("tuned");
});

test("a partly-read score keeps its number and loses its verdict", () => {
  const r = scoreState(0.8, true);
  expect(r.state).toBe("unread");
  expect(r.tone).toBe("neutral");
  expect(r.label).toBe("too little of the deck read to call this");
});

test("the needle stays on the arc at every extreme", () => {
  for (const r of [floorState(0, 10), floorState(99, 10), bandState(0, 36), bandState(99, 36), scoreState(0), scoreState(5)]) {
    expect(r.position).toBeGreaterThanOrEqual(-1);
    expect(r.position).toBeLessThanOrEqual(1);
  }
});

test("a target of zero never divides by zero", () => {
  expect(floorState(4, 0).state).toBe("on-target");
  expect(bandState(4, 0).state).toBe("on-band");
});
