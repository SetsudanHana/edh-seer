import { expect, test } from "vitest";
import { conditionalNote, fmtCount, gapOver, gapShort } from "./format-count.js";
import { floorState, overNote } from "./deck-gauge.js";

test("a count is floored to one decimal and never rounded up into a sure card", () => {
  expect(fmtCount(9.96)).toBe("9.9");
  expect(fmtCount(10)).toBe("10");
  expect(fmtCount(10.3)).toBe("10.3");
  expect(fmtCount(0.04)).toBe("0");
  expect(fmtCount(6.300000000000001)).toBe("6.3");
});

test("gaps come from the shown count: 9.96 of 10 is 0.1 short, and 10.04 is on target (no '0 short', no '0 over')", () => {
  expect(gapShort(9.96, 10)).toBe(0.1);
  expect(gapOver(10.04, 10)).toBe(0);
  expect(floorState(9.96, 10).label).toBe("0.1 short");
  expect(floorState(10.04, 10).label).toBe("on target");
  expect(floorState(11.2, 10).label).toBe("1.2 over, on target");
  expect(overNote(10.04, 10)).toBeNull();
  // the one-shot count prints clean (3.3000000000000007) and keeps its singular
  expect(overNote(14, 10, 3.3000000000000007)).toContain("the 3.3 that add little");
  expect(overNote(14, 10, 1)).toContain("the 1 that adds little");
});

test("the conditional note cannot round to a sure number: 0.97 and 0.04 are 'partly', 0.5 is 'half', 0 is 'for nothing'", () => {
  const row = (weight: number, card = "Card A", needs = "it was attacking") => ({ card, category: "draw", weight, basis: "unread" as const, needs });
  expect(conditionalNote([row(0.97)], ["draw"])).toBe("Card A counts partly: it only works if it was attacking.");
  expect(conditionalNote([row(0.04)], ["draw"])).toContain("counts partly");
  expect(conditionalNote([row(0.5)], ["draw"])).toContain("counts half");
  expect(conditionalNote([row(0)], ["draw"])).toContain("counts for nothing");
});

test("a gate cut in the wrong place is said without its text (Firespout), and a two-faced name is restored in case, `$` and all", () => {
  const firespout = { card: "Firespout", category: "boardWipe", weight: 0.5, basis: "unread" as const, needs: "{r} was spent to cast this spell and 3 damage to each creature with flying if {g} was spent to cast this spell" };
  expect(conditionalNote([firespout], ["boardWipe"])).toBe("Firespout counts half: it only works under a condition on the card.");
  const ral = { card: "Ral, Monsoon Mage // Ral, Leyline Prodigy", category: "draw", weight: 0.5, basis: "unread" as const, needs: "you control a blue permanent other than ral, monsoon mage" };
  expect(conditionalNote([ral], ["draw"])).toContain("other than Ral, Monsoon Mage.");
  const dollar = { card: "Cost $& Card", category: "draw", weight: 0.5, basis: "unread" as const, needs: "it is cost $& card" };
  expect(conditionalNote([dollar], ["draw"])).toContain("if it is Cost $& Card.");
});

test("an optional-cost choice counts whole and is said as 'when kicked', never as a chance (owner ruling 2026-10-27)", () => {
  const kicked = { card: "Into the Roil", category: "draw", weight: 1, basis: "choice" as const, needs: "this spell was kicked" };
  expect(conditionalNote([kicked], ["draw"])).toBe("Into the Roil counts whole when kicked.");
  const gift = { card: "Mind Spiral", category: "draw", weight: 1, basis: "choice" as const, needs: "the gift was promised" };
  expect(conditionalNote([gift], ["draw"])).toBe("Mind Spiral counts whole when the gift is promised.");
  expect(conditionalNote([kicked], ["ramp"])).toBe("");
});
