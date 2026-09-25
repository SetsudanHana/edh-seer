import { expect, test } from "vitest";
import { MIN_INDEXABLE_PARTNERS, isIndexableCard, jobOf } from "./partner-shard.js";

test("a card with a counted job is indexable without partners; a card with neither is not", () => {
  expect(isIndexableCard(0, ["ramp"])).toBe(true);
  expect(isIndexableCard(0, undefined)).toBe(false);
  expect(isIndexableCard(0, ["stax"])).toBe(false);
  expect(isIndexableCard(MIN_INDEXABLE_PARTNERS, undefined)).toBe(true);
});

test("a card with several roles is named by the first job in the report's order", () => {
  expect(jobOf(["draw", "ramp"])).toEqual({ noun: "ramp", tally: "Ramp" });
  expect(jobOf(["tutor"])).toEqual({ noun: "a tutor", tally: "Consistency" });
  expect(jobOf([])).toBeNull();
});
