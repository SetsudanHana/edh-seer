import { expect, test } from "vitest";
import { consensusCutAgreement } from "./quality-score-core.js";

test("a consensus cut agrees when it sits below the deck's median in its role", () => {
  const pct = new Map([
    ["Crib Swap", new Map([["targetedRemoval", 10]])],
    ["Swords to Plowshares", new Map([["targetedRemoval", 95]])],
    ["Path to Exile", new Map([["targetedRemoval", 90]])],
  ]);
  const roleOf = new Map([["Crib Swap", ["targetedRemoval"]], ["Swords to Plowshares", ["targetedRemoval"]], ["Path to Exile", ["targetedRemoval"]]]);
  expect(consensusCutAgreement({ cuts: ["Crib Swap"], roleOf, pct })).toEqual({ agree: 1, total: 1 });
  expect(consensusCutAgreement({ cuts: ["Swords to Plowshares"], roleOf, pct })).toEqual({ agree: 0, total: 1 });
});

test("a cut with no percentile in its role is not counted", () => {
  const pct = new Map([["Swords to Plowshares", new Map([["targetedRemoval", 95]])]]);
  const roleOf = new Map([["Sol Ring", ["ramp"]]]);
  expect(consensusCutAgreement({ cuts: ["Sol Ring"], roleOf, pct })).toEqual({ agree: 0, total: 0 });
});

test("a cut tied with the median counts half, and the only scored card in its role is not counted", () => {
  const pct = new Map([
    ["A", new Map([["draw", 50]])], ["B", new Map([["draw", 50]])], ["C", new Map([["draw", 90]])],
    ["Solo", new Map([["ramp", 10]])],
  ]);
  const roleOf = new Map([["A", ["draw"]], ["B", ["draw"]], ["C", ["draw"]], ["Solo", ["ramp"]]]);
  expect(consensusCutAgreement({ cuts: ["A"], roleOf, pct })).toEqual({ agree: 0.5, total: 1 });
  expect(consensusCutAgreement({ cuts: ["Solo"], roleOf, pct })).toEqual({ agree: 0, total: 0 });
});
