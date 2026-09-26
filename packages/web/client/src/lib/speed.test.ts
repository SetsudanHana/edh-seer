import { expect, test } from "vitest";
import type { DeckReport } from "../types.js";
import { fastestRoute, manaTurn, speedRoutes } from "./speed.js";

const row = (turn: number, p25: number, median: number, p75: number) =>
  ({ turn, mana: { p25, median, p75 }, payableShare: { p25: 0, median: 0, p75: 0 } });
const rows = [row(1, 1, 1, 1), row(2, 2, 2, 3), row(3, 2, 3, 4), row(4, 3, 4, 6), row(5, 4, 5, 7), row(6, 5, 6, 8), row(7, 6, 7, 9), row(8, 6, 8, 10)];

function deck(wincons: { class: string; cards?: string[] }[], clock?: number, combos: { cards: string[]; result: string }[] = []) {
  return {
    combos,
    manaAvailability: { trials: 2000, accelerants: 10, rows, headline: { mana: 6, turn: 6, low: 0.4, high: 0.6 } },
    deckMath: { clock: { turn: clock, powerAtFive: 8 }, wincons: { classes: wincons.map((w) => ({ ...w, count: w.cards?.length ?? 0, share: 0.25 })), focus: 0.5 } },
  } as unknown as DeckReport;
}
const mv: Record<string, number> = { "Dualcaster Mage": 3, "Essence Flux": 1, "Simic Ascendancy": 2, "Thassa's Oracle": 2 };

test("the mana a route needs is timed off the deck's own mana-by-turn rows, typical and spread", () => {
  expect(manaTurn(rows, 4)).toEqual({ turn: 4, early: 3, late: 5 });
  // Past the simulated turns the slow-game turn is unknown rather than guessed.
  expect(manaTurn(rows, 7).late).toBeUndefined();
});

test("every win route gets a line, and combat is only one of them", () => {
  const routes = speedRoutes(deck(
    [{ class: "go-wide", cards: ["Goblin Rabblemaster"] }, { class: "burn", cards: ["Impact Tremors"] }, { class: "alt-win", cards: ["Simic Ascendancy"] }],
    7,
    [{ cards: ["Dualcaster Mage", "Essence Flux"], result: "Infinite ETB" }, { cards: ["Sol Ring", "Arcane Signet"], result: "Mana" }],
  ), (n) => mv[n]);
  expect(routes.map((r) => r.kind)).toEqual(["combo", "alt-win", "combat", "burn"]);
  const combo = routes[0]!;
  expect(combo).toMatchObject({ label: "a combo: Dualcaster Mage + Essence Flux", mana: 4, turn: 4, early: 3, late: 5 });
  expect(combo.caveat).toMatch(/drawing or finding them is not counted/);
  expect(routes[2]).toMatchObject({ turn: 7, caveat: expect.stringMatching(/one opponent, if nobody blocks/) });
  // Untimed, but listed: leaving it off would read as "cannot win that way".
  expect(routes[3]!.turn).toBeUndefined();
  expect(routes[3]!.caveat).toMatch(/has no turn/);
  // The alternate win is castable at turn 2 but that is not when it wins, so the combo leads.
  expect(routes[1]!.turn).toBe(2);
  expect(fastestRoute(routes)?.kind).toBe("combo");
});

test("a win plan with no card list still gets its line", () => {
  const routes = speedRoutes(deck([{ class: "burn" }]), () => undefined);
  expect(routes.map((r) => r.kind)).toEqual(["burn"]);
});

test("a deck with no combat clock still reports its other routes", () => {
  const routes = speedRoutes(deck([{ class: "voltron", cards: ["Sigarda's Aid"] }, { class: "mill", cards: ["Bruvac the Grandiloquent"] }]), () => undefined);
  expect(routes.map((r) => [r.kind, r.turn])).toEqual([["combat", undefined], ["mill", undefined]]);
  expect(routes[0]!.caveat).toMatch(/not timed/);
  expect(fastestRoute(routes)).toBeUndefined();
});
