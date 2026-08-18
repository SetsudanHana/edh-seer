import { describe, expect, test } from "vitest";
import { diffRatings, type DeckRatings } from "./ratings-diff.js";

const card = (rating: number, over: Partial<{ score: number; partners: number; authority: number }> = {}) => ({
  rating, score: rating * 2, partners: 3, authority: 1, ...over,
});

const deck = (name: string, cards: Record<string, ReturnType<typeof card>>, facets = {}): DeckRatings => ({
  deck: name, breadth: 2, anchoring: 3, synergyOverall: 2.5, cards, ...facets,
});

test("an identical snapshot moves nothing", () => {
  const s = [deck("a", { Sol: card(5), Krenko: card(3) })];
  const d = diffRatings(s, structuredClone(s));

  expect(d.decks).toBe(1);
  expect(d.cardsCompared).toBe(2);
  expect(d.ratingsMoved).toBe(0);
  expect(d.scoresMoved).toBe(0);
  expect(d.meanAbsRatingDelta).toBe(0);
  expect(d.decksTopCardChanged).toEqual([]);
  expect(d.facetMoves).toEqual([]);
});

// THE DECK-RELATIVE CAVEAT, pinned: a uniform lift divides out, so every rating holds while every
// raw score moves. A tool that reported only "ratings moved: 0" would call this change inert.
test("a uniform score lift moves no rating but is still visible as moved scores", () => {
  const a = [deck("a", { Sol: card(5), Krenko: card(3) })];
  const b = [deck("a", {
    Sol: { ...card(5), score: 20 },
    Krenko: { ...card(3), score: 12 },
  })];

  const d = diffRatings(a, b);

  expect(d.ratingsMoved).toBe(0);
  expect(d.scoresMoved).toBe(2);
});

test("a moved rating is counted, averaged over ALL compared cards, and listed as a mover", () => {
  const a = [deck("a", { Sol: card(5), Krenko: card(3), Bird: card(1) })];
  const b = [deck("a", { Sol: card(5), Krenko: card(3), Bird: card(2.2) })];

  const d = diffRatings(a, b);

  expect(d.ratingsMoved).toBe(1);
  // 1.2 over three compared cards, not over the one that moved.
  expect(d.meanAbsRatingDelta).toBeCloseTo(0.4, 10);
  expect(d.topMovers).toEqual([{ deck: "a", name: "Bird", from: 1, to: 2.2 }]);
});

describe("what the report leads with", () => {
  test("the top card changing identity is reported", () => {
    const a = [deck("a", { Sol: card(5), Krenko: card(3) })];
    const b = [deck("a", { Sol: card(2), Krenko: card(3) })];

    expect(diffRatings(a, b).decksTopCardChanged).toEqual(["a"]);
  });

  test("a reshuffle INSIDE the top ten is not a membership change", () => {
    const names = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const a = deck("a", Object.fromEntries(names.map((n, i) => [n, card(5 - i * 0.1)])));
    // Swap the ratings of two cards that both stay inside the top ten.
    const b = structuredClone(a);
    b.cards.c2 = { ...b.cards.c2, rating: a.cards.c3.rating };
    b.cards.c3 = { ...b.cards.c3, rating: a.cards.c2.rating };

    const d = diffRatings([a], [b]);

    expect(d.ratingsMoved).toBe(2);
    expect(d.decksTopTenChanged).toEqual([]);
  });

  test("a card entering the top ten IS a membership change", () => {
    const names = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const a = deck("a", Object.fromEntries(names.map((n, i) => [n, card(5 - i * 0.1)])));
    const b = structuredClone(a);
    b.cards.c11 = { ...b.cards.c11, rating: 4.9 };

    expect(diffRatings([a], [b]).decksTopTenChanged).toEqual(["a"]);
  });
});

test("deck facets are diffed per facet, not as one blob", () => {
  const a = [deck("a", { Sol: card(5) })];
  const b = [deck("a", { Sol: card(5) }, { anchoring: 4, synergyOverall: 3 })];

  const d = diffRatings(a, b);

  expect(d.facetMoves).toEqual([
    { deck: "a", facet: "anchoring", from: 3, to: 4 },
    { deck: "a", facet: "synergyOverall", from: 2.5, to: 3 },
  ]);
});

// A card or a deck present on one side only cannot be compared, and must not be silently counted as
// unchanged -- that is how a shrinking population reads as a stable one.
test("cards and decks present on one side only are reported, never averaged in", () => {
  const a = [deck("a", { Sol: card(5), Gone: card(2) }), deck("only-a", { X: card(1) })];
  const b = [deck("a", { Sol: card(5), New: card(2) }), deck("only-b", { Y: card(1) })];

  const d = diffRatings(a, b);

  expect(d.decks).toBe(1);
  expect(d.decksOnlyInA).toEqual(["only-a"]);
  expect(d.decksOnlyInB).toEqual(["only-b"]);
  expect(d.cardsCompared).toBe(1);
  expect(d.cardsOnlyInA).toBe(1);
  expect(d.cardsOnlyInB).toBe(1);
});
