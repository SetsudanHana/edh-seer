import { expect, test } from "vitest";
import { HIDE_BELOW, SCROLL_TWITCH, headerHidden } from "./header-hide.js";

/** THE HEADER RETURNS ON SCROLL UP (owner 2026-09-08). Pinned on a phone but hidden while the
 *  reader scrolls down, back the moment they scroll up: the chapter rail's own rule, with the
 *  rail's own numbers, so the two bars move together. Wide viewports never hide it. */
test("a downward scroll past the threshold hides; any upward scroll shows", () => {
  expect(headerHidden({ y: 400, dy: 40, wide: false })).toBe(true);
  expect(headerHidden({ y: 400, dy: -40, wide: false })).toBe(false);
});

test("near the top the header stays, whichever way the thumb moves", () => {
  expect(headerHidden({ y: HIDE_BELOW, dy: 40, wide: false })).toBe(false);
  expect(headerHidden({ y: 50, dy: 40, wide: false })).toBe(false);
});

test("a twitch under the threshold is not a gesture and changes nothing", () => {
  expect(headerHidden({ y: 400, dy: SCROLL_TWITCH - 1, wide: false, was: true })).toBe(true);
  expect(headerHidden({ y: 400, dy: -(SCROLL_TWITCH - 1), wide: false, was: false })).toBe(false);
});

test("a wide viewport never hides the header", () => {
  expect(headerHidden({ y: 400, dy: 40, wide: true })).toBe(false);
});
