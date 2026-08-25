import { describe, expect, test } from "vitest";
import { COMMANDER_TAX_CAVEAT, COMMANDER_TAX_PER_CAST, DEFAULT_POD_SIZE, commanderTax, opponents } from "./format.js";
import { classifyLand, entersTapped } from "./land-conditions.js";

describe("pod size", () => {
  test("the default is a four-player Free-for-All, so three opponents", () => {
    expect(DEFAULT_POD_SIZE).toBe(4);
    expect(opponents()).toBe(3);
  });

  test("a three- or five-player table is an ordinary thing to sit at", () => {
    expect(opponents(3)).toBe(2);
    expect(opponents(5)).toBe(4);
  });

  test("a pod below two is clamped, never trusted — it will arrive from a UI field one day", () => {
    expect(opponents(1)).toBe(1);
    expect(opponents(0)).toBe(1);
    expect(opponents(-3)).toBe(1);
    expect(opponents(4.7)).toBe(3);
  });

  test("the one card it reaches today: Spectator Seating is untapped in a pod and tapped in a duel", () => {
    const seating = classifyLand({
      typeLine: "Land",
      oracleText: "This land enters tapped unless you have two or more opponents.\n{T}: Add {R} or {W}.",
    });
    const board = (podSize: number) =>
      ({ lands: 0, basics: 0, types: new Set<string>(), opponents: opponents(podSize) });
    expect(entersTapped(seating, board(4))).toBe(false);
    expect(entersTapped(seating, board(3))).toBe(false);
    expect(entersTapped(seating, board(2))).toBe(true);
  });
});

// J5 (2026-08-25): CR 903.8, as a CAVEAT and never a number. The tax is a function of how many
// times the commander has DIED, which nothing here simulates — the goldfish model casts no removal
// and has no opponent, so it cannot answer it either.
test("the commander tax is free once and {2} per recast", () => {
  // The FIRST cast is free of tax — which is what makes "available every game" true and misleading
  // at the same time.
  expect(commanderTax(1)).toBe(0);
  expect(commanderTax(2)).toBe(2);
  expect(commanderTax(3)).toBe(4);
  expect(commanderTax(4)).toBe(6);
  // A nonsense cast number cannot produce a negative tax.
  expect(commanderTax(0)).toBe(0);
  expect(commanderTax(-3)).toBe(0);
});

test("the caveat names the rule and the thing it does not model", () => {
  // Both halves matter: without the rule a reader cannot check it, and without the admission they
  // would take the silence for a model.
  expect(COMMANDER_TAX_CAVEAT).toMatch(/903\.8/);
  expect(COMMANDER_TAX_CAVEAT).toMatch(/nothing here models/i);
  expect(COMMANDER_TAX_CAVEAT).toContain(`{${COMMANDER_TAX_PER_CAST}}`);
});
