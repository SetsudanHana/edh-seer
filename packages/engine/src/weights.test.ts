import { expect, test } from "vitest";
import {
  globalIDF, rankThemes, themeWeights, weightedEdge, dampedScore,
  computeCohesion, cohesionLabel, COMBO_EDGE_WEIGHT, THEME_DECAY, type TagStats,
} from "./weights.js";

const stats: TagStats = { N: 100, counts: { "cast:sorcery": 80, "tribe:wizard": 5, "treasure": 2 } };

test("globalIDF decreases as count rises; a missing tag gets the max", () => {
  expect(globalIDF(stats, "cast:sorcery")).toBeLessThan(globalIDF(stats, "tribe:wizard"));
  expect(globalIDF(stats, "tribe:wizard")).toBeLessThan(globalIDF(stats, "treasure"));
  expect(globalIDF(stats, "brand:new")).toBeGreaterThanOrEqual(globalIDF(stats, "treasure"));
});

test("rankThemes orders by deckFreq × globalIDF, dense+rare first", () => {
  // cast:sorcery is dense in deck but common in corpus; tribe:wizard is dense AND rare.
  const deckFreq = new Map<string, number>([["cast:sorcery", 8], ["tribe:wizard", 6], ["treasure", 1]]);
  // tribe:wizard 6*idf(5)=~17.8 > cast:sorcery 8*idf(80)=~1.8 > treasure 1*idf(2)=~3.5
  expect(rankThemes(deckFreq, stats)).toEqual(["tribe:wizard", "treasure", "cast:sorcery"]);
});

test("themeWeights decay geometrically by rank: 1, 2/3, (2/3)^2 ...", () => {
  const deckFreq = new Map<string, number>([["cast:sorcery", 8], ["tribe:wizard", 6], ["treasure", 1]]);
  const w = themeWeights(deckFreq, stats);
  expect(w.get("tribe:wizard")).toBeCloseTo(1);
  expect(w.get("treasure")).toBeCloseTo(THEME_DECAY); // 2/3
  expect(w.get("cast:sorcery")).toBeCloseTo(THEME_DECAY * THEME_DECAY); // 4/9
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

test("cohesion names primary + secondary theme and scores the primary's deck share", () => {
  const deckFreq = new Map<string, number>([["cast:sorcery", 8], ["tribe:wizard", 6], ["treasure", 1]]);
  const ranked = rankThemes(deckFreq, stats);
  const c = computeCohesion(ranked, deckFreq, 10)!; // 10 nonland cards
  expect(c.tag).toBe("tribe:wizard");
  expect(c.secondaryTag).toBe("treasure");
  expect(c.score).toBeCloseTo(0.6); // deckFreq(primary) 6 / 10
  expect(c.label).toBe(cohesionLabel(c.score));
});

test("cohesion skips tribe-nontoken shadows when naming the theme", () => {
  // rankThemes would rank the nontoken shadow first (rarer), but it is not a real theme.
  const ranked = ["tribe-nontoken:wizard", "tribe:wizard", "cast:instant"];
  const deckFreq = new Map<string, number>([["tribe-nontoken:wizard", 6], ["tribe:wizard", 6], ["cast:instant", 3]]);
  const c = computeCohesion(ranked, deckFreq, 10)!;
  expect(c.tag).toBe("tribe:wizard");
  expect(c.secondaryTag).toBe("cast:instant");
});

test("cohesion caps at 1 and is null when there are no themes or no nonland cards", () => {
  const deckFreq = new Map<string, number>([["tribe:wizard", 40]]);
  expect(computeCohesion(rankThemes(deckFreq, stats), deckFreq, 20)!.score).toBe(1);
  expect(computeCohesion([], new Map(), 10)).toBeNull();
  expect(computeCohesion(["tribe:wizard"], new Map([["tribe:wizard", 5]]), 0)).toBeNull();
});
