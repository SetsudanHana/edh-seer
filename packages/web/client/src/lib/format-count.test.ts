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

test("prowl, surge, warp and foretold are said in their own word", () => {
  const row = (card: string, needs: string) => ({ card, category: "draw", weight: 1, basis: "choice" as const, needs });
  expect(conditionalNote([row("Morsel Theft", "this spell's prowl cost was paid")], ["draw"])).toBe("Morsel Theft counts whole when prowl is paid.");
  expect(conditionalNote([row("Crush of Tentacles", "this spell's surge cost was paid")], ["draw"])).toBe("Crush of Tentacles counts whole when surge is paid.");
  expect(conditionalNote([row("Full Bore", "that creature was cast for its warp cost")], ["draw"])).toBe("Full Bore counts whole when cast for its warp cost.");
  expect(conditionalNote([row("Poison the Cup", "this spell was foretold")], ["draw"])).toBe("Poison the Cup counts whole when foretold.");
});

test("an Otherwise gate names the card in its printed case, never '~' (Approach of the Second Sun)", () => {
  const needs = "it is not the case that this spell was cast from your hand and you've cast another spell named approach of the second sun this game";
  expect(conditionalNote([{ card: "Approach of the Second Sun", category: "lifegain", weight: 0.5, basis: "unread" as const, needs }], ["lifegain"]))
    .toBe("Approach of the Second Sun counts half: it only works if it is not the case that this spell was cast from your hand and you've cast another spell named Approach of the Second Sun this game.");
});

test("the Otherwise of a choice is said 'when not kicked / not bargained', and a lone opponent's-choice Otherwise reads plainly", () => {
  const row = (card: string, needs: string, weight = 1, basis: "choice" | "unread" = "choice") => ({ card, category: "handFill", weight, basis, needs });
  expect(conditionalNote([row("Thunderous Debut", "it is not the case that this spell was bargained")], ["handFill"])).toBe("Thunderous Debut counts whole when not bargained.");
  expect(conditionalNote([row("Sheoldred's Restoration", "it is not the case that this spell was kicked")], ["handFill"])).toBe("Sheoldred's Restoration counts whole when not kicked.");
  expect(conditionalNote([row("Protection Racket", "no opponent pays to stop it", 0.5, "unread")], ["handFill"])).toBe("Protection Racket counts half: it only works if no opponent pays to stop it.");
  expect(conditionalNote([row("Sin Prodder", "no opponent takes the deal", 0.5, "unread")], ["handFill"])).toBe("Sin Prodder counts half: it only works if no opponent takes the deal.");
});
