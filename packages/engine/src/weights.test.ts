import { expect, test } from "vitest";
import {
  globalIDF, rankThemes, themeWeights, weightedEdge, dampedScore,
  computeCohesion, cohesionLabel, COMBO_EDGE_WEIGHT, THEME_DECAY, tagFamily, type TagStats, THEME_NAME_FLOOR } from "./weights.js";

const stats: TagStats = { N: 100, counts: { "cast:sorcery": 80, "tribe:wizard": 5, "treasure": 2 } };

test("globalIDF decreases as count rises; a missing tag gets the max", () => {
  expect(globalIDF(stats, "cast:sorcery")).toBeLessThan(globalIDF(stats, "tribe:wizard"));
  expect(globalIDF(stats, "tribe:wizard")).toBeLessThan(globalIDF(stats, "treasure"));
  expect(globalIDF(stats, "brand:new")).toBeGreaterThanOrEqual(globalIDF(stats, "treasure"));
});

test("an ABSENT tag is CLAMPED to the rarest observed tag, never above it", () => {
  // log((100+1)/(0+1)) = 4.615 would out-rank every real tag in the corpus, including the
  // rarest one at 3.516 -- and a tag can be absent for reasons that are not rarity at all
  // (`attacks:lord` is chosen-type-resolved per deck, so gen-theme-stats can never count it).
  expect(globalIDF(stats, "brand:new")).toBeCloseTo(globalIDF(stats, "treasure"));
  expect(globalIDF(stats, "brand:new")).toBeLessThan(Math.log(101));
});

test("an empty corpus still degrades to the flat log(N+1) fallback", () => {
  // UNIFORM_STATS: nothing is observed, so there is no rarest tag to clamp to and every tag
  // must score the same constant -- the deckFreq-only behaviour the axis falls back to.
  const empty: TagStats = { N: 1, counts: {} };
  expect(globalIDF(empty, "anything")).toBeCloseTo(Math.log(2));
  expect(globalIDF(empty, "else")).toBeCloseTo(globalIDF(empty, "anything"));
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

// COHESION IS A SHARE OF CARDS (roadmap A7, 2026-08-19). Summing `deckFreq` across the family counts
// a card ONCE PER TAG it carries there, and once every permanent's own entry became a theme tag the
// sum ran past the card count: 5 of the 71 calibration decks read exactly 1.00 because
// `Math.min(1, ...)` clamped an over-count. The headline number was a ceiling, not a share.
test("cohesion counts distinct CARDS, so a card on two family tags is not counted twice", () => {
  // A GENERAL primary, so the whole family is in scope and the double-count is visible (roadmap
  // A10 made a SPECIFIC primary count only itself, which would hide it).
  const ranked = ["enters:creature", "enters:wizard"];
  const deckFreq = new Map([["enters:creature", 3], ["enters:wizard", 3]]);
  const fold = (t: string): string => (t === "enters:wizard" ? "enters:creature" : t);
  // Three cards, each carrying BOTH tags. The sum says 6/4 -> clamped to 1.00; the truth is 3/4.
  const cards = [
    new Set(["enters:wizard", "enters:creature"]),
    new Set(["enters:wizard", "enters:creature"]),
    new Set(["enters:wizard", "enters:creature"]),
    new Set(["draw:any"]),
  ];
  expect(computeCohesion(ranked, deckFreq, 4, fold)!.score).toBe(1); // the old over-count, clamped
  expect(computeCohesion(ranked, deckFreq, 4, fold, cards)!.score).toBeCloseTo(0.75);
});

test("a card counts once for the family even when it carries several of its tags", () => {
  const fold = (t: string): string => (t.startsWith("enters:") ? "enters:creature" : t);
  const cards = [new Set(["enters:wizard", "enters:human", "enters:creature"])];
  const c = computeCohesion(["enters:creature"], new Map([["enters:creature", 1]]), 2, fold, cards)!;
  expect(c.score).toBeCloseTo(0.5);
});

// A SPECIFIC PRIMARY MEASURES ITSELF; A GENERAL ONE MEASURES ITS FAMILY (roadmap A10). The label
// named one thing and the number measured another: inalla read "wizards entering 0.71" where 0.71
// was the share of the deck that is CREATURE-ish.
test("a GENERAL primary still measures its whole family -- the token fold is untouched", () => {
  const fold = (t: string): string => (t.startsWith("create-token:") ? "create-token:creature" : t);
  const cards = [
    new Set(["create-token:saproling"]), new Set(["create-token:goblin"]),
    new Set(["create-token:citizen"]), new Set(["draw:any"]),
  ];
  const deckFreq = new Map([["create-token:creature", 0], ["create-token:saproling", 1]]);
  const c = computeCohesion(["create-token:creature"], deckFreq, 4, fold, cards)!;
  expect(c.score).toBeCloseTo(0.75); // three of four, exactly as the family reading gave
});

test("a SPECIFIC primary measures only itself, not everything that shares its family", () => {
  const fold = (t: string): string => (t.startsWith("enters:") && t !== "enters:creature" ? "enters:creature" : t);
  const cards = [
    new Set(["enters:wizard", "enters:creature"]),
    new Set(["enters:wizard"]),
    new Set(["enters:goblin"]), // same FAMILY, different tribe -- must not count
    new Set(["enters:creature"]),
  ];
  const deckFreq = new Map([["enters:wizard", 2], ["enters:goblin", 1]]);
  const c = computeCohesion(["enters:wizard"], deckFreq, 4, fold, cards)!;
  expect(c.score).toBeCloseTo(0.5); // the two Wizards, not the Goblin and not the bare creature
});

// A NAME CAN BE SPECIFIC WHILE THE PLAN IS BROAD, and one number cannot say both (roadmap A10).
test("familyScore reports the wider family beside the theme's own share", () => {
  const fold = (t: string): string => (t.startsWith("enters:") && t !== "enters:creature" ? "enters:creature" : t);
  const cards = [
    new Set(["enters:dalek"]), new Set(["enters:goblin"]),
    new Set(["enters:goblin"]), new Set(["draw:any"]),
  ];
  const c = computeCohesion(["enters:dalek"], new Map([["enters:dalek", 1]]), 4, fold, cards)!;
  expect(c.score).toBeCloseTo(0.25);       // one Dalek of four nonlands
  expect(c.familyScore).toBeCloseTo(0.75); // three creatures of four
});

test("a general primary's two shares are the same number -- it IS its family", () => {
  const fold = (t: string): string => (t.startsWith("enters:") && t !== "enters:creature" ? "enters:creature" : t);
  const cards = [new Set(["enters:dalek"]), new Set(["draw:any"])];
  const c = computeCohesion(["enters:creature"], new Map([["enters:creature", 1]]), 2, fold, cards)!;
  expect(c.familyScore).toBe(c.score);
});

// A THEME CARRIED BY TWO CARDS MUST NOT NAME THE DECK (roadmap A15). The bar is NOT a correctness
// prediction: measured over the 71 calibration decks, cohesion does not separate right headlines
// from wrong ones (hits median 0.31, misses 0.33), and the worst wrong headline sits at 0.70. What
// it catches is a headline with no support -- `venser` reads 0.02, "proliferate", one card.
test("cohesion declines to name the deck below THEME_NAME_FLOOR", () => {
  const freq = new Map<string, number>([["proliferate:permanent", 1], ["draw:any", 1]]);
  const thin = computeCohesion(["proliferate:permanent", "draw:any"], freq, 50);
  expect(thin!.score).toBeLessThan(THEME_NAME_FLOOR);
  expect(thin!.dominant).toBe(false);
  // The tag is still reported -- it IS the deck's best-supported theme, and withholding it entirely
  // would be a different lie. Only the CLAIM that it names the deck is withdrawn.
  expect(thin!.tag).toBe("proliferate:permanent");
  const thick = computeCohesion(["proliferate:permanent", "draw:any"], new Map([["proliferate:permanent", 20]]), 50);
  expect(thick!.dominant).toBe(true);
});
