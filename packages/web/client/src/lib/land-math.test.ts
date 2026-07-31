import { expect, test } from "vitest";
import { landHandProbabilities } from "./land-math.js";

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
