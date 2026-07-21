import { expect, test } from "vitest";
import { SEED_IMPACT_WEIGHTS, UNKNOWN_KIND_WEIGHT, impactWeightOf } from "./impact.js";
import { loadImpactWeights, impactEdgeWeight, dampByAlpha } from "./impact.js";
import type { Reason } from "./synergy.js";

const r = (over: Partial<Reason>): Reason => ({ tag: "t", text: "", ...over });

test("impactWeightOf = kinds[effectKind] × repeatability[class]", () => {
  const w = impactWeightOf(r({ effectKind: "draw-card", repeatability: "triggered" }), SEED_IMPACT_WEIGHTS);
  expect(w).toBeCloseTo(1.0 * 1.0);
  const s = impactWeightOf(r({ effectKind: "pump", repeatability: "static" }), SEED_IMPACT_WEIGHTS);
  expect(s).toBeCloseTo(0.5 * 0.6);
});

test("unknown/missing effectKind falls back to UNKNOWN_KIND_WEIGHT", () => {
  expect(impactWeightOf(r({ effectKind: "no-such-kind", repeatability: "triggered" }), SEED_IMPACT_WEIGHTS))
    .toBeCloseTo(UNKNOWN_KIND_WEIGHT * 1.0);
  expect(impactWeightOf(r({ repeatability: "triggered" }), SEED_IMPACT_WEIGHTS))
    .toBeCloseTo(UNKNOWN_KIND_WEIGHT * 1.0);
});

test("missing repeatability is neutral (×1.0)", () => {
  expect(impactWeightOf(r({ effectKind: "draw-card" }), SEED_IMPACT_WEIGHTS)).toBeCloseTo(1.0);
});

test("seed config has one kind per EFFECT_KIND and all four repeatability classes", () => {
  expect(Object.keys(SEED_IMPACT_WEIGHTS.kinds).length).toBe(25);
  expect(Object.keys(SEED_IMPACT_WEIGHTS.repeatability).sort())
    .toEqual(["activated", "oneshot", "static", "triggered"]);
});

test("impactEdgeWeight sums over DISTINCT reason tags", () => {
  const reasons: Reason[] = [
    { tag: "enters:wizard", text: "", effectKind: "draw-card", repeatability: "triggered" },
    { tag: "enters:wizard", text: "", effectKind: "draw-card", repeatability: "triggered" }, // dup tag
    { tag: "static:pump", text: "", effectKind: "pump", repeatability: "static" },
  ];
  expect(impactEdgeWeight(reasons, SEED_IMPACT_WEIGHTS)).toBeCloseTo(1.0 + 0.5 * 0.6);
});

test("dampByAlpha divides by partnerCount^alpha; 0 partners → 0", () => {
  expect(dampByAlpha(10, 4, 0.5)).toBeCloseTo(5);   // /2
  expect(dampByAlpha(10, 4, 0)).toBeCloseTo(10);    // no damping
  expect(dampByAlpha(10, 0, 0.5)).toBe(0);
});

test("loadImpactWeights reads the committed JSON and has a numeric damping", () => {
  const w = loadImpactWeights();
  expect(typeof w.damping).toBe("number");
  expect(Object.keys(w.kinds).length).toBe(25);
});
