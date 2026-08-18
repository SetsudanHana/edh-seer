import { expect, test } from "vitest";
import {
  globalIDF, rankThemes, themeWeights, weightedEdge, dampedScore,
  computeCohesion, cohesionLabel, COMBO_EDGE_WEIGHT, THEME_DECAY, tagFamily, type TagStats,
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

test("cohesion secondary skips same-family tags to find a true second theme", () => {
  // Mirrors what rankThemes now produces on the Bant counters deck: the counter-added
  // family occupies the top two ranked slots (17 creature, 16 any), so secondary must
  // skip past the same-family tag to draw:any rather than repeat "counter added" as
  // both primary and secondary (describeTag has no counter-added case, so both tags
  // would otherwise render the identical label).
  const ranked = ["counter-added:creature", "counter-added:any", "draw:any"];
  const deckFreq = new Map([["counter-added:creature", 17], ["counter-added:any", 16], ["draw:any", 18]]);
  const c = computeCohesion(ranked, deckFreq, 20)!;
  expect(c.tag).toBe("counter-added:creature");
  expect(c.secondaryTag).toBe("draw:any");
});

test("cohesion secondary is null when every ranked tag shares the primary's family", () => {
  const ranked = ["counter-added:creature", "counter-added:any"];
  const deckFreq = new Map([["counter-added:creature", 17], ["counter-added:any", 16]]);
  const c = computeCohesion(ranked, deckFreq, 20)!;
  expect(c.secondaryTag).toBeNull();
});

test("cohesion caps at 1 and is null when there are no themes or no nonland cards", () => {
  const deckFreq = new Map<string, number>([["tribe:wizard", 40]]);
  expect(computeCohesion(rankThemes(deckFreq, stats), deckFreq, 20)!.score).toBe(1);
  expect(computeCohesion([], new Map(), 10)).toBeNull();
  expect(computeCohesion(["tribe:wizard"], new Map([["tribe:wizard", 5]]), 0)).toBeNull();
});

test("tagFamily strips the subject, leaving the mechanism", () => {
  expect(tagFamily("counter-added:creature")).toBe("counter-added");
  expect(tagFamily("counter-added:any")).toBe("counter-added");
  expect(tagFamily("draw:any")).toBe("draw");
  expect(tagFamily("combo")).toBe("combo");
});

test("a theme split across two subjects outranks a single denser tag", () => {
  // counter-added is 17 + 16 = 33 across two subjects; draw:any is 18 in one.
  const deckFreq = new Map([
    ["counter-added:creature", 17],
    ["counter-added:any", 16],
    ["draw:any", 18],
  ]);
  // equal rarity, so only the frequencies decide
  const stats = { N: 1000, counts: { "counter-added:creature": 100, "counter-added:any": 100, "draw:any": 100 } };
  const ranked = rankThemes(deckFreq, stats);
  expect(tagFamily(ranked[0])).toBe("counter-added");
});

test("ranking returns the strongest tag within a family, not the family name", () => {
  const deckFreq = new Map([["counter-added:creature", 17], ["counter-added:any", 16]]);
  const stats = { N: 1000, counts: { "counter-added:creature": 100, "counter-added:any": 100 } };
  expect(rankThemes(deckFreq, stats)[0]).toBe("counter-added:creature");
});

test("every input tag still appears in the ranking exactly once", () => {
  const deckFreq = new Map([["counter-added:creature", 17], ["counter-added:any", 16], ["draw:any", 18]]);
  const stats = { N: 1000, counts: { "counter-added:creature": 100, "counter-added:any": 100, "draw:any": 100 } };
  const ranked = rankThemes(deckFreq, stats);
  expect([...ranked].sort()).toEqual([...deckFreq.keys()].sort());
});

// --- Regression: only the literal ":any" sibling folds, never the whole family. ---

const UNIFORM: TagStats = { N: 1000, counts: {} }; // no tag has a corpus count, so every idf is
// the same constant and only deckFreq decides order -- isolates the family-grouping rule itself.

test("two different subjects of the same verb do not pool their weight (tribe:wizard vs tribe:goblin)", () => {
  // Whole-family-sum bug: tribe:wizard (weak alone) must not outrank a stronger unrelated tag
  // just because its sibling tribe:goblin is strong -- these are different tribes, not one
  // theme split across subject granularities like counter-added:creature/:any is.
  const deckFreq = new Map([["tribe:wizard", 3], ["tribe:goblin", 10], ["cast:instant", 5]]);
  expect(rankThemes(deckFreq, UNIFORM)).toEqual(["tribe:goblin", "cast:instant", "tribe:wizard"]);
});

test("a spread of static effect kinds does not outrank a real single-mechanism theme", () => {
  // cardThemeTags (matcher/edges.ts) puts the effect kind after "static:", so every static
  // effect in a deck used to sum into one family strong enough to beat a genuine theme even
  // though no individual static:* tag came close on its own.
  const deckFreq = new Map([
    ["counter-added:creature", 14],
    ["enters:creature", 8],
    ["enters:land", 7],
    ["static:pump", 5],
    ["static:mana-generation", 4],
    ["static:cost-reduction", 3],
    ["static:damage-multiplier", 2],
  ]);
  expect(rankThemes(deckFreq, UNIFORM)).toEqual([
    "counter-added:creature", "enters:creature", "enters:land",
    "static:pump", "static:mana-generation", "static:cost-reduction", "static:damage-multiplier",
  ]);
});

test("a real theme is not pushed to a fractional rank by many small same-family tags pooling", () => {
  // Before the fix, eight tribe:X tags at 3 each pooled to a "tribe" family weight of 24,
  // dropping cast:instant (12, no siblings) from rank 1 (weight 1.0) to rank 9
  // (weight (2/3)^8 ~= 0.039) in weightedEdge's real-theme accounting.
  const deckFreq = new Map<string, number>([["cast:instant", 12]]);
  for (const t of ["goblin", "wizard", "zombie", "elf", "human", "merfolk", "soldier", "spirit"]) {
    deckFreq.set(`tribe:${t}`, 3);
  }
  const w = themeWeights(deckFreq, UNIFORM);
  expect(w.get("cast:instant")).toBeCloseTo(1); // rank 1, not rank 9
});

// FAMILY-GROUPED RANKING (specs/2026-08-19-theme-family-ranking-design.md). alpha 0 must be the
// per-tag ranking byte for byte -- that is the wiring acceptance test -- and the naming rule uses
// tf-idf MASS, because count share was measured to generalise nine of twelve decks to "creatures
// entering" and cost every tribal deck its tribe.
const FOLD = (t: string): string => t.startsWith("enters:") && t !== "enters:any" && t !== "enters:creature"
  ? "enters:creature" : t;
const STATS = { N: 1000, counts: { "enters:creature": 400, "enters:wizard": 6, "enters:goblin": 6, "enters:rat": 6, "draw:any": 300 } };

test("alpha 0 leaves the per-tag ranking untouched", () => {
  const freq = new Map([["enters:wizard", 5], ["enters:creature", 9], ["draw:any", 12]]);
  const plain = rankThemes(freq, STATS);
  expect(rankThemes(freq, STATS, { fold: FOLD, alpha: 0, massShare: 0.5 })).toEqual(plain);
});

test("a family outranks a bigger common tag only once the rest of it counts", () => {
  // Sized so the premise holds: draw:any (idf 1.20) x 14 = 16.8 beats each fragment alone
  // (idf 4.96 x 3 = 14.9), and loses to the three of them summed.
  const freq = new Map([["enters:wizard", 3], ["enters:goblin", 3], ["enters:rat", 3], ["draw:any", 14]]);
  expect(rankThemes(freq, STATS)[0]).toBe("draw:any");
  const folded = rankThemes(freq, STATS, { fold: FOLD, alpha: 0.5, massShare: 0.5 })[0];
  expect(folded).toBe("enters:creature"); // spread family, so the family key names it
});

test("a mass-dominant child names its family; a spread family is named by the family key", () => {
  const tribal = new Map([["enters:wizard", 20], ["enters:goblin", 1], ["draw:any", 2]]);
  expect(rankThemes(tribal, STATS, { fold: FOLD, alpha: 0.5, massShare: 0.5 })[0]).toBe("enters:wizard");
  const spread = new Map([["enters:wizard", 4], ["enters:goblin", 4], ["enters:rat", 4], ["draw:any", 2]]);
  expect(rankThemes(spread, STATS, { fold: FOLD, alpha: 0.5, massShare: 0.5 })[0]).toBe("enters:creature");
});

test("mass beats count: a rare child names a family it does not dominate by count", () => {
  // wizard is 6 of 16 by COUNT (37%, under the old rule) but carries the rare tag, so most of the
  // family's tf-idf mass -- exactly the case count share got wrong.
  const freq = new Map([["enters:wizard", 6], ["enters:creature", 10]]);
  const out = rankThemes(freq, STATS, { fold: FOLD, alpha: 0.5, massShare: 0.5 })[0];
  expect(out).toBe("enters:wizard");
});
