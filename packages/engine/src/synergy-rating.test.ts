import { expect, test } from "vitest";
import { computeSynergyRatings } from "./synergy-rating.js";

test("empty deck yields no ratings and zero coherence", () => {
  const out = computeSynergyRatings([]);
  expect(out.ratingByName.size).toBe(0);
  expect(out.positiveCoherence).toBe(0);
});

test("all-zero scores yield zero ratings and zero coherence", () => {
  const out = computeSynergyRatings([
    { name: "A", score: 0, isNonland: true },
    { name: "B", score: 0, isNonland: true },
  ]);
  expect(out.ratingByName.get("A")).toBe(0);
  expect(out.positiveCoherence).toBe(0);
});

test("the top card rates 5 and a half-strength card rates 2.5", () => {
  const out = computeSynergyRatings([
    { name: "Top", score: 10, isNonland: true },
    { name: "Half", score: 5, isNonland: true },
    { name: "None", score: 0, isNonland: true },
  ]);
  expect(out.ratingByName.get("Top")).toBe(5);
  expect(out.ratingByName.get("Half")).toBe(2.5);
  expect(out.ratingByName.get("None")).toBe(0);
});

test("coherence is the mean rating over nonland cards", () => {
  const out = computeSynergyRatings([
    { name: "Top", score: 10, isNonland: true },
    { name: "Half", score: 5, isNonland: true },
    { name: "None", score: 0, isNonland: true },
  ]);
  expect(out.positiveCoherence).toBe(2.5);
});

test("lands are excluded from coherence but still get a per-card rating", () => {
  const withLands = computeSynergyRatings([
    { name: "Top", score: 10, isNonland: true },
    { name: "Filler", score: 0, isNonland: true },
    { name: "Island", score: 0, isNonland: false },
    { name: "Swamp", score: 0, isNonland: false },
  ]);
  expect(withLands.positiveCoherence).toBe(2.5);
  expect(withLands.ratingByName.get("Island")).toBe(0);
});

test("a focused deck scores higher coherence than a one-bomb pile", () => {
  const focused = computeSynergyRatings([
    { name: "A", score: 10, isNonland: true },
    { name: "B", score: 9, isNonland: true },
    { name: "C", score: 8, isNonland: true },
  ]);
  const pile = computeSynergyRatings([
    { name: "Bomb", score: 10, isNonland: true },
    { name: "X", score: 0, isNonland: true },
    { name: "Y", score: 0, isNonland: true },
  ]);
  expect(focused.positiveCoherence).toBeGreaterThan(pile.positiveCoherence);
});
