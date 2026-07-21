import { expect, test } from "vitest";
import { buildReport, formatReport, type PairResult } from "./compass-report.js";
import type { GoldPair, Outcome } from "./eval-pairs-core.js";

const gp = (category: GoldPair["category"]): GoldPair => ({
  a: "A", b: "B", category, note: "", source: "t", verified: true,
});

const result = (category: GoldPair["category"], outcome: Outcome): PairResult => ({
  pair: gp(category), outcome,
});

test("recall = pass / total; per-category tallies pass and total", () => {
  const r = buildReport([
    result("aristocrats", { status: "PASS", reasons: [] }),
    result("aristocrats", { status: "NO-EDGE", reasons: [], noEdgeCause: "NO-LINKING-RULE" }),
    result("reanimator", { status: "WRONG-REASON", reasons: [] }),
  ]);
  expect(r.total).toBe(3);
  expect(r.pass).toBe(1);
  expect(r.recall).toBeCloseTo(1 / 3);
  expect(r.perCategory.aristocrats).toEqual({ pass: 1, total: 2 });
  expect(r.perCategory.reanimator).toEqual({ pass: 0, total: 1 });
});

test("causes tallies non-PASS outcomes by cause label", () => {
  const r = buildReport([
    result("aristocrats", { status: "NO-EDGE", reasons: [], noEdgeCause: "MISSING-TAG-A" }),
    result("reanimator", { status: "WRONG-REASON", reasons: [] }),
  ]);
  expect(r.causes["MISSING-TAG-A"]).toBe(1);
  expect(r.causes["WRONG-REASON"]).toBe(1);
});

test("formatReport includes the overall recall and a per-category line", () => {
  const text = formatReport(buildReport([result("aristocrats", { status: "PASS", reasons: [] })]));
  expect(text).toContain("recall");
  expect(text).toContain("aristocrats");
});
