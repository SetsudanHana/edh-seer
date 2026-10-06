import { expect, test } from "vitest";
import type { DeckReport } from "../types.js";
import { fastestRoute, manaTurn, speedRoutes } from "./speed.js";

const row = (turn: number, p25: number, median: number, p75: number) =>
  ({ turn, mana: { p25, median, p75 }, payableShare: { p25: 0, median: 0, p75: 0 } });
const rows = [row(1, 1, 1, 1), row(2, 2, 2, 3), row(3, 2, 3, 4), row(4, 3, 4, 6), row(5, 4, 5, 7), row(6, 5, 6, 8), row(7, 6, 7, 9), row(8, 6, 8, 10)];

type DrainSpeed = { turn?: number; perTurn: number[]; cards: string[]; unbounded: string[] };
function deck(wincons: { class: string; cards?: string[]; drain?: { cards: number; life: number } }[], clock?: number, combos: { cards: string[]; result: string }[] = [], drain?: DrainSpeed, table?: number) {
  return {
    combos,
    manaAvailability: { trials: 2000, accelerants: 10, rows, headline: { mana: 6, turn: 6, low: 0.4, high: 0.6 } },
    deckMath: { clock: { turn: clock, powerAtFive: 8 }, ...(drain || table !== undefined ? { speed: { ...(drain ? { drain } : {}), ...(table !== undefined ? { combat: { turn: table } } : {}) } } : {}), wincons: { classes: wincons.map((w) => ({ ...w, count: w.cards?.length ?? 0, share: 0.25 })), focus: 0.5 } },
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
    undefined, 11,
  ), (n) => mv[n]);
  expect(routes.map((r) => r.kind)).toEqual(["combo", "alt-win", "combat", "burn"]);
  const combo = routes[0]!;
  expect(combo).toMatchObject({ label: "a combo: Dualcaster Mage + Essence Flux", mana: 4, turn: 4, early: 3, late: 5 });
  expect(combo.caveat).toMatch(/drawing or finding them is not counted/);
  // The whole table (11), not the one-opponent clock (7): #1056 R1.
  expect(routes[2]).toMatchObject({ turn: 11, caveat: expect.stringMatching(/all three opponents, if nobody blocks/) });
  // Untimed, but listed: leaving it off would read as "cannot win that way".
  expect(routes[3]!.turn).toBeUndefined();
  expect(routes[3]!.caveat).toMatch(/not timed yet/);
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

/** THE DRAIN IS TIMED (#1056, owner 2026-10-06: speed is the turn the whole table can be dead, a
 *  rough floor per route). The turn comes from `deckMath.speed.drain`; the caveat says what it
 *  assumes and names a source that grows with the board. */
test("a drain route takes its whole-table turn from the drain clock, and says what it assumes", () => {
  const timed = { turn: 9, perTurn: [], cards: ["Impact Tremors", "Blood Artist"], unbounded: ["Krenko, Mob Boss"] };
  const [burn] = speedRoutes(deck([{ class: "burn", cards: ["Impact Tremors", "Blood Artist"] }], undefined, [], timed), () => undefined);
  expect(burn!.turn).toBe(9);
  expect(burn!.caveat).toBe("when its 2 repeating drains at each opponent have taken 40 from every opponent, each firing once per creature, token or spell that sets it off, and nobody gaining life; Krenko, Mob Boss counted as one a turn, though it grows with your board");
  expect(fastestRoute([burn!])?.kind).toBe("burn");
  const [slow] = speedRoutes(deck([{ class: "burn", cards: ["Leech"] }], undefined, [], { perTurn: [], cards: ["Leech"], unbounded: [] }), () => undefined);
  expect(slow!.turn).toBeUndefined();
  expect(slow!.caveat).toBe("its 1 repeating drain at each opponent does not take 40 from every opponent by turn 20 at one fire per source");
  const [plain] = speedRoutes(deck([{ class: "burn", cards: ["Bolt"] }]), () => undefined);
  expect(plain!.caveat).toBe("its burn is one-shot or aimed at one player, which is not timed yet");
});

/** COMBAT IS TIMED FOR THE WHOLE TABLE (#1056 R1): the route reads `deckMath.speed.combat`, the
 *  turn the board has dealt 120, not the one-opponent clock -- which stays the horizon. */
test("the combat route takes its turn from the whole-table combat speed, not the one-opponent clock", () => {
  const [combat] = speedRoutes(deck([{ class: "go-wide", cards: ["Goblin Rabblemaster"] }], 6, [], undefined, 9), () => undefined);
  expect(combat!.turn).toBe(9);
  expect(combat!.caveat).toBe("enough attacking power to kill all three opponents, if nobody blocks and nothing is removed");
  const [none] = speedRoutes(deck([{ class: "go-wide", cards: ["Goblin Rabblemaster"] }], 6), () => undefined);
  expect(none!.turn).toBeUndefined();
  expect(none!.caveat).toBe("not timed: in our test games the board never deals 120, enough for all three opponents");
});

/** COMMANDER DAMAGE IS ITS OWN ROUTE (#1056 R2): a voltron deck's commander-damage turn, listed
 *  beside combat, and the fastest when it is. */
test("a voltron deck gets a commander-damage route with its whole-table turn", () => {
  const r = { ...deck([{ class: "voltron", cards: ["Sigarda's Aid"] }], 6, [], undefined, 14) } as DeckReport;
  (r.deckMath as { speed: Record<string, unknown> }).speed.commander = { commander: "Light-Paws", turn: 9 };
  const routes = speedRoutes(r, () => undefined);
  expect(routes.map((x) => [x.kind, x.turn])).toEqual([["combat", 14], ["commander", 9]]);
  expect(routes[1]!.label).toBe("commander damage: Light-Paws");
  expect(fastestRoute(routes)?.kind).toBe("commander");
});

/** A COMMANDER THAT PREVENTS YOUR DAMAGE (The Mindskinner) times no damage route, and says so. */
test("a damage-preventing commander leaves combat, commander and drain untimed, naming it", () => {
  const r = deck([{ class: "voltron", cards: ["Plate"] }, { class: "burn", cards: ["Leech"] }], 6) as DeckReport;
  (r.deckMath as { speed?: Record<string, unknown> }).speed = { prevented: "The Mindskinner", combat: {}, commander: { commander: "The Mindskinner" } };
  const routes = speedRoutes(r, () => undefined);
  expect(routes.map((x) => [x.kind, x.turn, x.caveat])).toEqual([
    ["combat", undefined, "not timed: The Mindskinner prevents your damage to opponents"],
    ["commander", undefined, "not timed: The Mindskinner prevents your damage to opponents"],
    ["burn", undefined, "not timed: The Mindskinner prevents your damage to opponents"],
  ]);
});
