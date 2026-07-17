import { expect, test } from "vitest";
import {
  globalIDF, density, tagWeight, weightedEdge, dampedScore,
  computeCohesion, cohesionLabel, COMBO_EDGE_WEIGHT, type TagStats,
} from "./weights.js";

const stats: TagStats = { N: 100, counts: { "cast:sorcery": 80, "tribe:wizard": 5, "treasure": 2 } };

test("globalIDF decreases as count rises; a missing tag gets the max", () => {
  expect(globalIDF(stats, "cast:sorcery")).toBeLessThan(globalIDF(stats, "tribe:wizard"));
  expect(globalIDF(stats, "tribe:wizard")).toBeLessThan(globalIDF(stats, "treasure"));
  expect(globalIDF(stats, "brand:new")).toBeGreaterThanOrEqual(globalIDF(stats, "treasure"));
});

test("density grows with deck frequency (sqrt), min 1", () => {
  expect(density(1)).toBe(1);
  expect(density(4)).toBe(2);
  expect(density(0)).toBe(1);
  expect(density(9)).toBeGreaterThan(density(4));
});

test("tagWeight combines idf and density", () => {
  expect(tagWeight(stats, "tribe:wizard", 4)).toBeCloseTo(globalIDF(stats, "tribe:wizard") * 2);
});

test("weightedEdge collapses duplicate tags and honors combos", () => {
  const w = (t: string) => (t === "tribe:wizard" ? 3 : 1);
  expect(weightedEdge([{ tag: "tribe:wizard" }, { tag: "tribe:wizard" }, { tag: "cast:instant" }], w)).toBe(4);
  expect(weightedEdge([{ tag: "combo" }, { tag: "tribe:wizard" }], w)).toBe(COMBO_EDGE_WEIGHT);
});

test("damped score tempers breadth: few strong edges can beat many weak", () => {
  expect(dampedScore(8, 8)).toBeLessThan(dampedScore(6, 2)); // 2.83 < 4.24
  expect(dampedScore(0, 0)).toBe(0);
});

test("cohesion picks the highest freq*idf theme and scores its share", () => {
  const deckFreq = new Map<string, number>([["cast:sorcery", 8], ["tribe:wizard", 6], ["treasure", 1]]);
  const c = computeCohesion(deckFreq, stats)!;
  expect(c.tag).toBe("tribe:wizard");
  expect(c.score).toBeGreaterThan(0);
  expect(c.score).toBeLessThanOrEqual(1);
  expect(c.label).toBe(cohesionLabel(c.score));
});

test("cohesion is null for an empty deck", () => {
  expect(computeCohesion(new Map(), stats)).toBeNull();
});
