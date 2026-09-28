import { expect, test } from "vitest";
import { DERIVE_VERSION } from "@edh-seer/tagger";
import { RULES_VERSION } from "./rules.js";
import { loadQualityWeights, ROLES } from "./quality.js";
import { fallbackWeights } from "./quality-fit.js";

test("the weights were fitted at the current derive and rules versions (refit: npm run gen:quality-weights -w @edh-seer/matcher)", () => {
  const w = loadQualityWeights();
  expect(w.deriveVersion).toBe(DERIVE_VERSION);
  expect(w.rulesVersion).toBe(RULES_VERSION);
});

test("every role has an entry, and a fallback role ships exactly its fallback weights", () => {
  const w = loadQualityWeights();
  for (const r of ROLES) {
    expect(w.roles[r]).toBeDefined();
    if (w.roles[r].fallback) expect(w.roles[r].weights).toEqual(fallbackWeights(r));
  }
});
