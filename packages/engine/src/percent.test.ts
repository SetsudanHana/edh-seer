import { expect, test } from "vitest";
import { band, percent } from "./percent.js";

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
