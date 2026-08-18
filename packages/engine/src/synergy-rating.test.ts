import { expect, test } from "vitest";
import { computeSynergyRatings } from "./synergy-rating.js";

test("empty deck yields no ratings and zero coherence", () => {
  const out = computeSynergyRatings([]);
  expect(out.ratingByName.size).toBe(0);
  expect(out.positiveCoherence).toBe(0);
});

test("all-zero scores yield zero ratings and zero coherence", () => {
  const out = computeSynergyRatings([
    { name: "A", score: 0, payoffScore: 0, feederScore: 0, isNonland: true, axisWeight: 0 },
    { name: "B", score: 0, payoffScore: 0, feederScore: 0, isNonland: true, axisWeight: 0 },
  ]);
  expect(out.ratingByName.get("A")).toBe(0);
  expect(out.positiveCoherence).toBe(0);
});

test("the top card rates 5 and a half-strength card rates 2.5", () => {
  const out = computeSynergyRatings([
    { name: "Top", score: 10, payoffScore: 10, feederScore: 0, isNonland: true, axisWeight: 1 },
    { name: "Half", score: 5, payoffScore: 5, feederScore: 0, isNonland: true, axisWeight: 1 },
    { name: "None", score: 0, payoffScore: 0, feederScore: 0, isNonland: true, axisWeight: 0 },
  ]);
  expect(out.ratingByName.get("Top")).toBe(5);
  expect(out.ratingByName.get("Half")).toBe(2.5);
  expect(out.ratingByName.get("None")).toBe(0);
});

test("coverage: mean of best axis weight over counted cards, scaled to 5", () => {
  // (1 + 1 + 0) / 3 nonland cards -> 5 * 2/3 = 3.3
  const out = computeSynergyRatings([
    { name: "A", score: 10, payoffScore: 10, feederScore: 0, isNonland: true, axisWeight: 1 },
    { name: "B", score: 4, payoffScore: 4, feederScore: 0, isNonland: true, axisWeight: 1 },
    { name: "C", score: 0, payoffScore: 0, feederScore: 0, isNonland: true, axisWeight: 0 },
  ]);
  expect(out.positiveCoherence).toBeCloseTo(3.3, 1);
});

test("a partial axis weight contributes partial coverage (graded, not binary)", () => {
  // (1 + 0.5) / 2 nonland cards -> 5 * 0.75 = 3.75, rounds to 3.8
  const out = computeSynergyRatings([
    { name: "A", score: 10, payoffScore: 10, feederScore: 0, isNonland: true, axisWeight: 1 },
    { name: "B", score: 4, payoffScore: 4, feederScore: 0, isNonland: true, axisWeight: 0.5 },
  ]);
  expect(out.positiveCoherence).toBe(3.8);
});

test("coverage reaches 5 when every nonland card is fully on-axis", () => {
  const out = computeSynergyRatings([
    { name: "A", score: 10, payoffScore: 10, feederScore: 0, isNonland: true, axisWeight: 1 },
    { name: "B", score: 3, payoffScore: 3, feederScore: 0, isNonland: true, axisWeight: 1 },
  ]);
  expect(out.positiveCoherence).toBe(5);
});

test("an off-axis nonland card drags coverage down (stays in the denominator)", () => {
  // (1 + 0) / 2 nonland cards -> 2.5
  const out = computeSynergyRatings([
    { name: "A", score: 10, payoffScore: 10, feederScore: 0, isNonland: true, axisWeight: 1 },
    { name: "B", score: 6, payoffScore: 6, feederScore: 0, isNonland: true, axisWeight: 0 },
  ]);
  expect(out.positiveCoherence).toBe(2.5);
});

test("a basic land is excluded from coverage; a utility land with an on-axis edge counts", () => {
  // Denominator = A (nonland) + Cradle (land, axisWeight > 0) = 2; sum of weights = 1 + 1 = 2 -> 5.
  // The basic Island (land, axisWeight 0) is excluded entirely.
  const out = computeSynergyRatings([
    { name: "A", score: 10, payoffScore: 10, feederScore: 0, isNonland: true, axisWeight: 1 },
    { name: "Gaea's Cradle", score: 5, payoffScore: 5, feederScore: 0, isNonland: false, axisWeight: 1 },
    { name: "Island", score: 0, payoffScore: 0, feederScore: 0, isNonland: false, axisWeight: 0 },
  ]);
  expect(out.positiveCoherence).toBe(5);
});

test("no on-axis cards yields zero coverage; empty deck yields zero", () => {
  expect(
    computeSynergyRatings([{ name: "A", score: 3, payoffScore: 3, feederScore: 0, isNonland: true, axisWeight: 0 }])
      .positiveCoherence,
  ).toBe(0);
  expect(computeSynergyRatings([]).positiveCoherence).toBe(0);
});

test("role ratings share the headline's denominator, so the components sum to it", () => {
  // deckMax is 10 (the top card's score). Both roles divide by that same 10, which is what makes
  // a feeder's number comparable against a payoff's.
  const out = computeSynergyRatings([
    { name: "Top", score: 10, payoffScore: 6, feederScore: 4, isNonland: true, axisWeight: 1 },
    { name: "Enabler", score: 4, payoffScore: 0, feederScore: 4, isNonland: true, axisWeight: 1 },
  ]);
  expect(out.ratingByName.get("Top")).toBe(5);
  expect(out.payoffRatingByName.get("Top")).toBe(3);
  expect(out.feederRatingByName.get("Top")).toBe(2);
  // A pure enabler reads payoff 0 / feeder 2 — the sentence the blended number could never say.
  expect(out.payoffRatingByName.get("Enabler")).toBe(0);
  expect(out.feederRatingByName.get("Enabler")).toBe(2);
});

test("role ratings are zero when the deck has no score at all", () => {
  const out = computeSynergyRatings([
    { name: "A", score: 0, payoffScore: 0, feederScore: 0, isNonland: true, axisWeight: 0 },
  ]);
  expect(out.payoffRatingByName.get("A")).toBe(0);
  expect(out.feederRatingByName.get("A")).toBe(0);
});
