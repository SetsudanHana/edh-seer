import { expect, test } from "vitest";
import { computeCohesion } from "@edh-seer/engine";
import { keyDenotes, subsumptionMap } from "./hierarchy.js";

test("a cast: family drops land, because a land is played and not cast", () => {
  // CR 305.1. Without it `-creature` contains land and is not a subset of `spell`, which breaks the
  // chain at its middle link — and "noncreature spell" plainly is a spell.
  expect(keyDenotes("any", "cast")?.has("land")).toBe(false);
  expect(keyDenotes("-creature", "cast")?.has("land")).toBe(false);
  expect(keyDenotes("any", "enters")?.has("land")).toBe(true);
});

test("the WIDER tag absorbs the narrower ones, so the combined claim names the deck", () => {
  const m = subsumptionMap(["cast:instant", "cast:-creature", "cast:spell"]);
  expect(m.get("cast:spell")).toEqual(expect.arrayContaining(["cast:-creature", "cast:instant"]));
  expect(m.get("cast:-creature")).toEqual(["cast:instant"]);
  expect(m.get("cast:instant")).toEqual([]);
});

test("a subtype is refused, which is what keeps this off the refused family fold", () => {
  // `wizard` really is a subset of `creature`, and folding it that way is the ranking that
  // generalised nine of twelve decks to "creatures entering".
  expect(keyDenotes("wizard", "enters")).toBeUndefined();
  // ABSENT FROM THE MAP, not present-and-empty, and the difference is load-bearing: `rankThemes`
  // falls back to the incumbent ":any" rule for a tag the map says nothing about, so a subtype tag
  // keeps exactly the behaviour it had.
  expect(subsumptionMap(["enters:wizard", "enters:creature"]).has("enters:wizard")).toBe(false);
});

test("families do not reach across each other", () => {
  expect(subsumptionMap(["cast:instant", "enters:spell"]).get("cast:instant")).toEqual([]);
});

test("two tags denoting the same set subsume neither", () => {
  // The same claim spelled twice; crediting both would double-count it.
  const m = subsumptionMap(["enters:noncreature", "enters:-creature"]);
  expect(m.get("enters:noncreature")).toEqual([]);
  expect(m.get("enters:-creature")).toEqual([]);
});

test("a type outside its family's universe denotes nothing rather than everything", () => {
  // An empty set is a subset of every set, so `cast:land` would absorb the whole family.
  expect(keyDenotes("land", "cast")).toBeUndefined();
  expect(keyDenotes("land", "enters")?.has("land")).toBe(true);
});

test("cohesion counts a card whose theme sits INSIDE the primary's claim", () => {
  // The whole item: `cast:instant` is inside `cast:-creature`, and counting them apart left three
  // decks the owner named "spellslinger" with no theme at all. Ranking is untouched — the primary
  // is still whatever ranked first.
  const deckFreq = new Map([["cast:-creature", 2], ["cast:instant", 2]]);
  const cards = [
    new Set(["cast:-creature"]), new Set(["cast:-creature"]),
    new Set(["cast:instant"]), new Set(["cast:instant"]),
    new Set(["enters:creature"]), new Set(["enters:creature"]),
  ];
  const without = computeCohesion(["cast:-creature"], deckFreq, 6, (t) => t, cards);
  const with_ = computeCohesion(["cast:-creature"], deckFreq, 6, (t) => t, cards,
    subsumptionMap(deckFreq.keys()));
  expect(without?.score).toBeCloseTo(2 / 6, 6);
  expect(with_?.score).toBeCloseTo(4 / 6, 6);
});

test("a card whose theme is WIDER than the primary is not on it", () => {
  // Cohesion is a share of the PRIMARY's claim. A card that casts creatures is not on a
  // "noncreature spells" theme, so `cast:spell` must not count toward it.
  const deckFreq = new Map([["cast:-creature", 1], ["cast:spell", 3]]);
  const cards = [new Set(["cast:-creature"]), new Set(["cast:spell"]), new Set(["cast:spell"]), new Set(["cast:spell"])];
  const c = computeCohesion(["cast:-creature"], deckFreq, 4, (t) => t, cards,
    subsumptionMap(deckFreq.keys()));
  expect(c?.score).toBeCloseTo(1 / 4, 6);
});
