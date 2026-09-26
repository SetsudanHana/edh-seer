import { expect, test } from "vitest";
import { landHandProbabilities, nextLandChance } from "./land-math.js";

test("returns handSize+1 entries", () => {
  expect(landHandProbabilities(38, 99)).toHaveLength(8);
  expect(landHandProbabilities(38, 99, 5)).toHaveLength(6);
});

test("probabilities sum to 1 for a realistic 99-card deck", () => {
  const probs = landHandProbabilities(38, 99);
  const sum = probs.reduce((s, p) => s + p, 0);
  expect(sum).toBeCloseTo(1, 9);
});

test("zero lands in the deck means P(0 lands in hand) = 1", () => {
  const probs = landHandProbabilities(0, 99);
  expect(probs[0]).toBe(1);
  expect(probs.slice(1).every((p) => p === 0)).toBe(true);
});

test("an all-land deck means P(7 lands in a 7-hand) = 1", () => {
  const probs = landHandProbabilities(99, 99);
  expect(probs[7]).toBe(1);
  expect(probs.slice(0, 7).every((p) => p === 0)).toBe(true);
});

test("a deck smaller than the hand size returns all zeros, not NaN", () => {
  const probs = landHandProbabilities(2, 5, 7);
  expect(probs).toHaveLength(8);
  expect(probs.every((p) => p === 0)).toBe(true);
});

test("a two-land keep finds its third land at the hypergeometric odds, and more lands raise them", () => {
  // 36 lands in 99: after a 2-land 7, 34 lands in the 92-card library. Two draws on the play.
  const onPlay = nextLandChance(36, 99, 2);
  expect(onPlay).toBeCloseTo(1 - (58 / 92) * (57 / 91), 10);
  expect(nextLandChance(36, 99, 3)).toBeGreaterThan(onPlay);
  expect(nextLandChance(38, 99, 2)).toBeGreaterThan(onPlay);
  // A deck with no lands left to draw cannot find one.
  expect(nextLandChance(2, 99, 3)).toBe(0);
});
