import { expect, test } from "vitest";
import { computeDeckStats } from "./deck-stats.js";
import { FIXTURES } from "./fixtures.js";

test("lands are excluded from the curve and counted separately", () => {
  const stats = computeDeckStats([FIXTURES.krenko, FIXTURES.forest, FIXTURES.forest]);
  expect(stats.landCount).toBe(2);
  expect(stats.manaCurve[4].count).toBe(1); // Krenko, manaValue 4
  expect(stats.manaCurve.reduce((sum, b) => sum + b.count, 0)).toBe(1); // lands excluded
});

test("mana values of 7 or higher collapse into the last bucket", () => {
  const stats = computeDeckStats([FIXTURES.craterhoofBehemoth]); // manaValue 8
  expect(stats.manaCurve[7]).toEqual({ value: 7, count: 1 });
});

test("avg and median manaValue over a 9-card nonland deck", () => {
  const deck = [
    FIXTURES.krenko, // 4
    FIXTURES.impactTremors, // 2
    FIXTURES.dockside, // 2
    FIXTURES.fireweaver, // 2
    FIXTURES.cultivate, // 3
    FIXTURES.swordsToPlowshares, // 1
    FIXTURES.divination, // 3
    FIXTURES.thassasOracle, // 2
    FIXTURES.consultation, // 1
  ];
  const stats = computeDeckStats(deck);
  expect(stats.avgManaValue).toBeCloseTo(20 / 9, 10);
  expect(stats.medianManaValue).toBe(2);
});

test("median averages the two middle values on an even-count deck", () => {
  const stats = computeDeckStats([FIXTURES.swordsToPlowshares, FIXTURES.divination]); // 1, 3
  expect(stats.medianManaValue).toBe(2);
});

test("empty deck reports zeros, not NaN", () => {
  const stats = computeDeckStats([]);
  expect(stats.avgManaValue).toBe(0);
  expect(stats.medianManaValue).toBe(0);
  expect(stats.landCount).toBe(0);
  expect(stats.manaCurve).toHaveLength(8);
});
