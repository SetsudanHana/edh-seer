import { expect, test } from "vitest";
import { deprecatedGrindAllowed } from "./tag-batch-api.js";

// The flat extractor measured 43% correct / 43% partial / 13% wrong and 30% reproducible, and
// PROMPT_VERSION 24 marks all ~20,400 tag docs stale — so an accidental grind costs ~$70 to
// reproduce those numbers. The guard has to be deliberate, not satisfiable by muscle memory.

test("the deprecated grind is refused unless explicitly allowed", () => {
  expect(deprecatedGrindAllowed({})).toBe(false);
  expect(deprecatedGrindAllowed({ ALLOW_DEPRECATED_GRIND: "1" })).toBe(true);
});

test("near-miss values do not unlock it", () => {
  for (const v of ["", "0", "true", "yes", "TRUE", " 1"]) {
    expect(deprecatedGrindAllowed({ ALLOW_DEPRECATED_GRIND: v })).toBe(false);
  }
});
