import { expect, test } from "vitest";
import { SEED_IMPACT_WEIGHTS, type ImpactWeights } from "@mtg/engine";
import { saltCardScores, spearman, meanSpearman, fitWeights, looCV, type SaltPayload } from "./calibrate-core.js";

test("saltCardScores recursively sums every conditionScoring.total in a card's entry", () => {
  // Real CommanderSalt shape: list[slug] = { <group>: { <id>: { conditionScoring: { total } } } },
  // where group is replacements/triggers/statics/… and each conditionScoring is one object (not array).
  const scores = saltCardScores({
    details: { synergy: { list: {
      kindred_discovery: {
        replacements: { "7745": { conditionScoring: { total: 0.6, subTotals: { triggers: 0 } } } },
        triggers: {
          cd5e: { conditionScoring: { total: 78.5 } },
          ab12: { conditionScoring: { total: 41.6 } },
        },
      },
      impact_tremors: {
        triggers: { z9: { conditionScoring: { total: 5 } } },
      },
    } } },
  } as SaltPayload);
  expect(scores.get("kindred_discovery")).toBeCloseTo(120.7);
  expect(scores.get("impact_tremors")).toBeCloseTo(5);
});

test("spearman is 1 for identical order, -1 for reversed", () => {
  expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
  expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1);
});

test("fitWeights improves in-sample mean Spearman over the priors on a constructed case", () => {
  // Two cards per deck: card 0's score depends only on draw-card, card 1 only on damage.
  // Salt ranks draw-card card ABOVE damage card. A scorer that weights kinds toward the
  // salt order should beat the flat prior where both kinds are equal.
  const flatPrior: ImpactWeights = {
    kinds: { "draw-card": 0.5, damage: 0.5 },
    repeatability: { triggered: 1 },
    scaling: { fixed: 1 },
    damping: 0.5,
  };
  const scoreDeck = (w: ImpactWeights) => [w.kinds["draw-card"], w.kinds["damage"]];
  const salts = [[10, 1]]; // draw-card card ranked first
  const before = meanSpearman([scoreDeck], salts, flatPrior);
  const fitted = fitWeights([scoreDeck], salts, flatPrior, { restarts: 4, iterations: 40, lambda: 0.0, seed: 1 });
  const after = meanSpearman([scoreDeck], salts, fitted);
  expect(after).toBeGreaterThanOrEqual(before);
  expect(fitted.kinds["draw-card"]).toBeGreaterThan(fitted.kinds["damage"]);
});

test("fitWeights is deterministic for a fixed seed", () => {
  const prior: ImpactWeights = { kinds: { a: 0.5, b: 0.5 }, repeatability: { triggered: 1 }, scaling: { fixed: 1 }, damping: 0.5 };
  const scoreDeck = (w: ImpactWeights) => [w.kinds.a, w.kinds.b];
  const opts = { restarts: 3, iterations: 20, lambda: 0.01, seed: 42 };
  const f1 = fitWeights([scoreDeck], [[10, 1]], prior, opts);
  const f2 = fitWeights([scoreDeck], [[10, 1]], prior, opts);
  expect(f1).toEqual(f2);
});

test("looCV returns inSample and loo numbers over 2+ decks", () => {
  const prior: ImpactWeights = { kinds: { a: 0.5, b: 0.5 }, repeatability: { triggered: 1 }, scaling: { fixed: 1 }, damping: 0.5 };
  const d0 = (w: ImpactWeights) => [w.kinds.a, w.kinds.b];
  const d1 = (w: ImpactWeights) => [w.kinds.a, w.kinds.b];
  const res = looCV([d0, d1], [[10, 1], [10, 1]], prior, { restarts: 2, iterations: 15, lambda: 0.01, seed: 7 });
  expect(typeof res.inSample).toBe("number");
  expect(typeof res.loo).toBe("number");
});

test("looCV reports progress once per restart across all (N+1) fits, ending at total", () => {
  const prior: ImpactWeights = { kinds: { a: 0.5, b: 0.5 }, repeatability: { triggered: 1 }, scaling: { fixed: 1 }, damping: 0.5 };
  const d0 = (w: ImpactWeights) => [w.kinds.a, w.kinds.b];
  const d1 = (w: ImpactWeights) => [w.kinds.a, w.kinds.b];
  const restarts = 3;
  const calls: [number, number][] = [];
  looCV([d0, d1], [[10, 1], [10, 1]], prior, { restarts, iterations: 5, lambda: 0.01, seed: 7 },
    (done, total) => calls.push([done, total]));
  const total = (2 + 1) * restarts; // (N decks + 1 in-sample) × restarts
  expect(calls.length).toBe(total);
  expect(calls[calls.length - 1]).toEqual([total, total]);
  expect(calls.map(([d]) => d)).toEqual([...Array(total)].map((_, i) => i + 1)); // 1..total, monotonic
});

test("fitWeights tunes scaling params toward the salt order", () => {
  // Card 0's score depends only on scaling.high, card 1 only on scaling.low. Salt ranks card 0 above.
  const prior: ImpactWeights = {
    kinds: { x: 1 }, repeatability: { triggered: 1 },
    scaling: { high: 0.5, low: 0.5 }, damping: 0.5,
  };
  const scoreDeck = (w: ImpactWeights) => [w.scaling.high, w.scaling.low];
  const fitted = fitWeights([scoreDeck], [[10, 1]], prior, { restarts: 4, iterations: 40, lambda: 0, seed: 1 });
  expect(fitted.scaling.high).toBeGreaterThan(fitted.scaling.low);
});
