import { expect, test } from "vitest";
import { fitAll, fitRole, pairAccuracy, splitBySet, SIGN, type Pair } from "./quality-fit.js";
import { qualityScore } from "./quality.js";

const pair = (set: string, cutMv: number, addMv: number, extra: Partial<Pair> = {}): Pair =>
  ({ role: "targetedRemoval", set, cut: { manaValue: cutMv, timing: 2 }, add: { manaValue: addMv, timing: 2 }, weight: 1, ...extra });

test("a cheaper add is learned as better, and the sign constraint holds", () => {
  const train = Array.from({ length: 40 }, (_, i) => pair(`s${i % 5}`, 4, 2));
  const w = fitRole(train);
  expect(w.manaValue).toBeLessThan(0);
  expect(pairAccuracy(train, w)).toBe(1);
  expect(SIGN.manaValue).toBe(-1);
});

test("a missing ingredient drops from that pair and never counts as 0", () => {
  const p: Pair = { role: "targetedRemoval", set: "a", cut: { manaValue: 2, timing: 2 }, add: { manaValue: 2, timing: 2, permanence: 3 }, weight: 1 };
  const w = fitRole([p, p, p]);
  expect(w.permanence ?? 0).toBe(0);
});

test("a sign-constrained ingredient never counts against a card even when the data pushes it", () => {
  // players 'prefer' the SLOWER card in these pairs; timing may not go negative
  const p: Pair = { role: "targetedRemoval", set: "a", cut: { manaValue: 2, timing: 2 }, add: { manaValue: 2, timing: 0 }, weight: 1 };
  expect(fitRole([p, p, p]).timing ?? 0).toBeGreaterThanOrEqual(0);
});

test("split by set keeps every set whole, and is deterministic", () => {
  const pairs = Array.from({ length: 50 }, (_, i) => pair(`set${i % 10}`, 3, 2));
  const { train, test: held } = splitBySet(pairs, 7, 0.2);
  const tr = new Set(train.map((p) => p.set));
  expect(held.some((p) => tr.has(p.set))).toBe(false);
  expect(held.length).toBeGreaterThan(0);
  expect(splitBySet(pairs, 7, 0.2)).toEqual({ train, test: held });
});

test("a role under 150 pairs falls back to mana value and timing", () => {
  const w = fitAll(Array.from({ length: 20 }, (_, i) => pair(`s${i % 5}`, 4, 2)), { deriveVersion: 1, rulesVersion: 1 });
  expect(w.roles.targetedRemoval.fallback).toBe(true);
  expect(w.roles.stax.fallback).toBe(true);
  expect(Object.keys(w.roles.stax.weights).sort()).toEqual(["manaValue", "timing"]);
});

test("qualityScore needs manaValue and timing", () => {
  const w = { weights: { manaValue: -1, timing: 0.5 }, pairs: 200, heldOutAccuracy: 0.8, baselineAccuracy: 0.7, fallbackAccuracy: 0.75, fallback: false };
  expect(qualityScore({ manaValue: 1, timing: 2 }, w)!).toBeGreaterThan(qualityScore({ manaValue: 4, timing: 0 }, w)!);
  expect(qualityScore({ timing: 2 }, w)).toBeNull();
});

test("a tie counts half: a pair the weights cannot separate is a coin flip, not a miss", () => {
  const tie: Pair = { role: "targetedRemoval", set: "a", cut: { manaValue: 2, timing: 2 }, add: { manaValue: 2, timing: 2 }, weight: 1 };
  expect(pairAccuracy([tie], { manaValue: -1 })).toBe(0.5);
});

test("the fallback's own held-out accuracy is recorded beside the fit's", () => {
  const pairs = Array.from({ length: 200 }, (_, i) => pair(`set${i % 20}`, 4, 2));
  const w = fitAll(pairs, { deriveVersion: 1, rulesVersion: 1 });
  expect(w.roles.targetedRemoval.fallbackAccuracy).toBeTypeOf("number");
});

test("a pair with an empty side is not a pair: it neither counts toward the minimum nor scores as a tie", () => {
  const empty: Pair = { role: "targetedRemoval", set: "a", cut: {}, add: { manaValue: 2, timing: 2 }, weight: 1 };
  const w = fitAll([...Array.from({ length: 149 }, (_, i) => pair(`s${i % 10}`, 4, 2)), empty, empty], { deriveVersion: 1, rulesVersion: 1 });
  expect(w.roles.targetedRemoval.pairs).toBe(149);
  expect(w.roles.targetedRemoval.fallback).toBe(true); // 149 usable pairs, under 150
});
