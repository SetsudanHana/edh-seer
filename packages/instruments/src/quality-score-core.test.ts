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
