import { expect, test } from "vitest";
import { formatCount, gapOver, gapShort } from "./format-count.js";
import { deckSlack } from "./cut-list.js";

test("a count is floored to one decimal, never rounded up into a sure card", () => {
  expect(formatCount(9.96)).toBe("9.9");
  expect(formatCount(9.99999)).toBe("9.9");
  expect(formatCount(10)).toBe("10");
  expect(formatCount(10.3)).toBe("10.3");
  expect(formatCount(0.04)).toBe("0");
  expect(formatCount(6.300000000000001)).toBe("6.3");
});

test("a gap is taken from the shown count: 9.96 of 10 is 0.1 short, 0.04 over is on target, never '0 short' or '0 over'", () => {
  expect(gapShort(9.96, 10)).toBe(0.1);
  expect(gapShort(10, 10)).toBe(0);
  expect(gapOver(10.04, 10)).toBe(0);
  expect(gapOver(11.2, 10)).toBe(1.2);
});

test("a surplus under one card is no spare slot: 10.3 against 10 is not slack, 11.2 is", () => {
  const row = (count: number) => ({ name: "Ramp", key: "ramp", count, target: 10 });
  expect(deckSlack([row(10.3)] as never)).toEqual([]);
  expect(deckSlack([row(11.2)] as never).map((s) => s.over)).toEqual([1.2]);
});
