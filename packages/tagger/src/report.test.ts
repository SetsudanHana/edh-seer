import { expect, test } from "vitest";
import { formatReport, PASS_THRESHOLD } from "./report.js";

test("gate threshold is 0.8", () => {
  expect(PASS_THRESHOLD).toBe(0.8);
});

test("report shows PASS above threshold and chars rate", () => {
  const text = formatReport({
    cards: [{ oracleId: "a", charsExact: true, abilityTP: 5, abilityFP: 0, abilityFN: 0 }],
    charsExactRate: 1,
    precision: 1,
    recall: 1,
    f1: 1,
  });
  expect(text).toContain("F1");
  expect(text).toContain("PASS");
  expect(text).toContain("chars");
});

test("report shows FAIL below threshold", () => {
  const text = formatReport({
    cards: [], charsExactRate: 1, precision: 0.5, recall: 0.5, f1: 0.5,
  });
  expect(text).toContain("FAIL");
});
