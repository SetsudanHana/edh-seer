import { expect, test } from "vitest";
import { deriveScopeFilter } from "./derive-scope.js";

// OWNER 2026-10-25: an unreleased spoiler card is previewed, so derive-corpus takes it although
// Scryfall marks it not_legal in every format until release.
test("derive scope is commander-legal cards plus upcoming spoilers", () => {
  expect(deriveScopeFilter()).toEqual({ $or: [{ "legalities.commander": "legal" }, { upcoming: { $exists: true } }] });
});
