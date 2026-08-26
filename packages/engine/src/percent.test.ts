import { expect, test } from "vitest";
import { band, percent, policyBand } from "./percent.js";

// N6. THE FLOOR BELONGS ON THE REFUSAL PATH, NOT ON A MEASURED ZERO. A castability of exactly 0 in
// 20,000 of 20,000 trials is a MEASUREMENT, and printing it as "1%" claims the cast is possible;
// a model that cannot price a card prints an em dash instead, which is the refusal this floor was
// written for. The CLI floored and the web `CardList` did not, so the two surfaces disagreed on the
// same cell.
test("a measured zero prints 0%, and a real chance never rounds to it", () => {
  expect(percent(0)).toBe("0%");
  expect(percent(1)).toBe("100%");
  expect(percent(0.5)).toBe("50%");
  // Rounds to zero but is not zero: "0%" reads as "cannot happen" and "1%" overstates it 200-fold.
  expect(percent(0.004)).toBe("<1%");
  expect(percent(0.0001)).toBe("<1%");
  expect(percent(0.006)).toBe("1%");
});

// A degenerate range collapses to one figure -- "62% - 62%" reads as a broken range, and a range
// whose ends round the same IS one figure.
test("a range collapses when its ends round alike", () => {
  expect(band(0.62, 0.62)).toBe("62%");
  expect(band(0.618, 0.622)).toBe("62%");
  expect(band(0.34, 0.43)).toBe("34% – 43%");
  expect(band(0, 0)).toBe("0%");
  expect(band(0, 0.004)).toBe("0% – <1%");
});

// THE POLICY INTERVAL COLLAPSES BELOW 8pp (owner's call, 2026-08-26). The range is the PLAY POLICY,
// not an error bar -- the low end holds up two mana, the high end spends everything on acceleration.
// Measured over the 71 decks its width is median 6.5pp and p90 14.5pp, so most decks are told the
// same thing twice while `iz-it-izzet` genuinely reads 30% - 67%. One number where the policy barely
// matters, both where it decides the answer.
test("a policy interval narrower than 8pp reads as one number, and a wide one keeps both ends", () => {
  // The CONSERVATIVE end survives: it holds up two mana, which is nearer how a deck is really played,
  // and picking the ceiling would print the number no real deck reaches.
  expect(policyBand(0.48, 0.55)).toBe("48%");
  expect(policyBand(0.62, 0.62)).toBe("62%");
  // Exactly at the threshold is still a range: the rule is "narrower THAN 8pp".
  expect(policyBand(0.30, 0.38)).toBe("30% – 38%");
  expect(policyBand(0.30, 0.67)).toBe("30% – 67%");
  // A measured zero is still zero, and a rounding-to-zero low end still says <1%.
  expect(policyBand(0, 0.02)).toBe("0%");
  expect(policyBand(0.001, 0.02)).toBe("<1%");
});
