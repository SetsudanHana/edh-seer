import { expect, test } from "vitest";
import { stickyPx } from "./sticky-px.js";

const withHeight = (height: number): Element =>
  ({ getBoundingClientRect: () => ({ height }) }) as unknown as Element;

/** THE SEAM DEFECT, PINNED AT ITS CAUSE.
 *
 *  Reported from a screenshot on 2026-09-04: a hairline of scrolling content showing between the
 *  site header and the report header. Measured in the browser at 824px -- the header is 57.5px tall,
 *  `Math.round` wrote 58, the report header pinned at 58, and 57.5 to 58 was a transparent slit with
 *  the page moving behind it. Half a pixel is enough: what came through was the tops of capitals.
 *
 *  ROUNDING DOWN IS NOT A TIE-BREAK, IT IS THE DIRECTION THAT IS SAFE. Too small overlaps the bar
 *  below by under a pixel and cannot be seen, because both paint `--background`. Too large is a hole.
 *  That asymmetry is the whole rule, so `.5` is the case the test names. */
test("a fractional bar height rounds DOWN, so the bar below overlaps rather than gaps", () => {
  expect(stickyPx(withHeight(57.5))).toBe("57px");
  expect(stickyPx(withHeight(57.99))).toBe("57px");
  expect(stickyPx(withHeight(72.5))).toBe("72px");
});

test("a whole number is left alone", () => {
  expect(stickyPx(withHeight(49))).toBe("49px");
  expect(stickyPx(withHeight(0))).toBe("0px");
});
