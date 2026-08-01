import { expect, test } from "vitest";
import { computeSynergyRatings } from "./synergy-rating.js";

test("empty deck yields no ratings and zero coherence", () => {
  const out = computeSynergyRatings([]);
  expect(out.ratingByName.size).toBe(0);
  expect(out.positiveCoherence).toBe(0);
});

test("all-zero scores yield zero ratings and zero coherence", () => {
  const out = computeSynergyRatings([
    { name: "A", score: 0, isNonland: true, onAxis: false },
    { name: "B", score: 0, isNonland: true, onAxis: false },
  ]);
  expect(out.ratingByName.get("A")).toBe(0);
  expect(out.positiveCoherence).toBe(0);
});

test("the top card rates 5 and a half-strength card rates 2.5", () => {
  const out = computeSynergyRatings([
    { name: "Top", score: 10, isNonland: true, onAxis: true },
    { name: "Half", score: 5, isNonland: true, onAxis: true },
    { name: "None", score: 0, isNonland: true, onAxis: false },
  ]);
  expect(out.ratingByName.get("Top")).toBe(5);
  expect(out.ratingByName.get("Half")).toBe(2.5);
  expect(out.ratingByName.get("None")).toBe(0);
});

test("coverage: share of cards with an on-axis edge, scaled to 5", () => {
  // 2 of 3 nonland cards are on-axis -> 5 * 2/3 = 3.3
  const out = computeSynergyRatings([
    { name: "A", score: 10, isNonland: true, onAxis: true },
    { name: "B", score: 4, isNonland: true, onAxis: true },
    { name: "C", score: 0, isNonland: true, onAxis: false },
  ]);
  expect(out.positiveCoherence).toBeCloseTo(3.3, 1);
});

test("coverage reaches 5 when every nonland card is on-axis", () => {
  const out = computeSynergyRatings([
    { name: "A", score: 10, isNonland: true, onAxis: true },
    { name: "B", score: 3, isNonland: true, onAxis: true },
  ]);
  expect(out.positiveCoherence).toBe(5);
});

test("an off-axis nonland card drags coverage down (stays in the denominator)", () => {
  // 1 on-axis of 2 nonland -> 2.5
  const out = computeSynergyRatings([
    { name: "A", score: 10, isNonland: true, onAxis: true },
    { name: "B", score: 6, isNonland: true, onAxis: false },
  ]);
  expect(out.positiveCoherence).toBe(2.5);
});

test("a basic land is excluded from coverage; a utility land with an on-axis edge counts", () => {
  // Denominator = A (nonland) + Cradle (land, on-axis) = 2; numerator = both on-axis = 2 -> 5.
  // The basic Island (land, not on-axis) is excluded from both.
  const out = computeSynergyRatings([
    { name: "A", score: 10, isNonland: true, onAxis: true },
    { name: "Gaea's Cradle", score: 5, isNonland: false, onAxis: true },
    { name: "Island", score: 0, isNonland: false, onAxis: false },
  ]);
  expect(out.positiveCoherence).toBe(5);
});

test("no on-axis cards yields zero coverage; empty deck yields zero", () => {
  expect(
    computeSynergyRatings([{ name: "A", score: 3, isNonland: true, onAxis: false }]).positiveCoherence,
  ).toBe(0);
  expect(computeSynergyRatings([]).positiveCoherence).toBe(0);
});
