import { expect, test } from "vitest";
import { applyDecision, pendingIndices } from "./review-core.js";
import type { GoldPair } from "./eval-pairs-core.js";

const pair = (verified: boolean, a = "A"): GoldPair => ({
  a, b: "B", category: "aristocrats", note: "", source: "llm-proposed", verified,
});

test("pendingIndices lists only unverified entries", () => {
  expect(pendingIndices([pair(true), pair(false), pair(false)])).toEqual([1, 2]);
});

test("accept flips verified true, leaving the entry in place", () => {
  const out = applyDecision([pair(false)], 0, "accept");
  expect(out[0].verified).toBe(true);
  expect(out).toHaveLength(1);
});

test("reject removes the entry", () => {
  const out = applyDecision([pair(false, "A"), pair(false, "C")], 0, "reject");
  expect(out).toHaveLength(1);
  expect(out[0].a).toBe("C");
});
