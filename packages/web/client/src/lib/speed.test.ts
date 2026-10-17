import { expect, test } from "vitest";
import type { DeckReport } from "../types.js";
import { fastestRoute, manaTurn, noFinisher, noFinisherClause, repeats, speedRoutes } from "./speed.js";

const row = (turn: number, p25: number, median: number, p75: number) =>
  ({ turn, mana: { p25, median, p75 }, payableShare: { p25: 0, median: 0, p75: 0 } });
const rows = [row(1, 1, 1, 1), row(2, 2, 2, 3), row(3, 2, 3, 4), row(4, 3, 4, 6), row(5, 4, 5, 7), row(6, 5, 6, 8), row(7, 6, 7, 9), row(8, 6, 8, 10)];

type DrainSpeed = { turn?: number; perTurn: number[]; cards: string[]; unbounded: string[] };
function deck(wincons: { class: string; cards?: string[]; drain?: { cards: number; life: number } }[], clock?: number, combos: { cards: string[]; result: string; payoffs?: { name: string; on: string[]; effect: string }[] }[] = [], drain?: DrainSpeed, table?: number) {
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
    [{ cards: ["Dualcaster Mage", "Essence Flux"], result: "Infinite ETB", payoffs: [{ name: "Impact Tremors", on: ["Dualcaster Mage"], effect: "damage" }] }, { cards: ["Sol Ring", "Arcane Signet"], result: "Mana" }],
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
  expect(combat!.caveat).toBe("half our test games have dealt 120 by then, enough for all three opponents, if nobody blocks and nothing is removed");
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

/** MILL IS TIMED (#1056 R4): the route takes `deckMath.speed.mill`'s turn and says what it assumes. */
test("a mill route takes its whole-table turn from the mill clock", () => {
  const r = deck([{ class: "mill", cards: ["Ruin Crab"] }]) as DeckReport;
  (r.deckMath as { speed?: Record<string, unknown> }).speed = { combat: {}, mill: { turn: 13, perTurn: [], cards: ["Ruin Crab", "Hedron Crab"], unbounded: [] } };
  const [mill] = speedRoutes(r, () => undefined);
  expect(mill).toMatchObject({ kind: "mill", turn: 13 });
  expect(mill!.caveat).toBe("when 2 mill cards have emptied every opponent's library, each firing once per thing that sets it off; their own extra draws would make it sooner");
  expect(fastestRoute([mill!])?.kind).toBe("mill");
});

/** A TIMED MILL SHOWS EVEN WHEN THE MILL PLAN CLASS DID NOT FIRE (review of #1056 R4): The Mindskinner
 *  turns the board into mill, which no mill card in the list announces. */
test("a timed mill route is listed even without a mill win-plan class", () => {
  const r = deck([{ class: "voltron", cards: ["Plate"] }]) as DeckReport;
  (r.deckMath as { speed?: Record<string, unknown> }).speed = { combat: {}, mill: { turn: 10, perTurn: [], cards: ["The Mindskinner"], unbounded: [] } };
  expect(speedRoutes(r, () => undefined).map((x) => [x.kind, x.turn])).toEqual([["combat", undefined], ["mill", 10]]);
});

/** POISON IS ITS OWN ROUTE (#1056 R3). */
test("a poison route takes its whole-table turn from the poison clock", () => {
  const r = deck([{ class: "voltron", cards: ["Plate"] }]) as DeckReport;
  (r.deckMath as { speed?: Record<string, unknown> }).speed = { combat: {}, poison: { turn: 9, perTurn: [], cards: ["Blighted Agent", "Atraxa, Praetors' Voice"], unbounded: [] } };
  const routes = speedRoutes(r, () => undefined);
  expect(routes.map((x) => [x.kind, x.turn])).toEqual([["combat", undefined], ["poison", 9]]);
  expect(routes[1]!.caveat).toMatch(/ten poison counters/);
  expect(fastestRoute(routes)?.kind).toBe("poison");
});

/** A SOURCE COUNTED AT ITS FLOOR IS SAID (#1260): mill and poison name an `unbounded` source the way
 *  the drain caveat does, timed or not, so "not by turn 20" reads as the floor it is. */
test("mill and poison caveats name a source counted as one a turn, timed or not", () => {
  const r = deck([{ class: "voltron", cards: ["Plate"] }, { class: "mill", cards: ["Ghost Vacuum"] }]) as DeckReport;
  const speed = (r.deckMath as { speed?: Record<string, unknown> });
  speed.speed = {
    combat: {}, poison: { perTurn: [], cards: ["Blighted Agent"], unbounded: ["Atraxa, Praetors' Voice"] },
    mill: { perTurn: [], cards: ["Ghost Vacuum", "Ruin Crab"], unbounded: ["Ghost Vacuum", "Bruvac the Grandiloquent"] },
  };
  const untimed = Object.fromEntries(speedRoutes(r, () => undefined).map((x) => [x.kind, x.caveat]));
  expect(untimed.poison).toBe("not timed: it does not put ten poison counters on every opponent by turn 20; Atraxa, Praetors' Voice counted as one a turn, though it grows with your board");
  expect(untimed.mill).toBe("its 2 mill cards do not empty every opponent's library by turn 20; Ghost Vacuum, Bruvac the Grandiloquent counted as one a turn, though they grow with your board");
  speed.speed = {
    combat: {}, poison: { turn: 9, perTurn: [], cards: ["Blighted Agent"], unbounded: ["Atraxa, Praetors' Voice"] },
    mill: { turn: 13, perTurn: [], cards: ["Ghost Vacuum"], unbounded: ["Ghost Vacuum"] },
  };
  const timed = Object.fromEntries(speedRoutes(r, () => undefined).map((x) => [x.kind, x.caveat]));
  expect(timed.poison).toMatch(/already poisoned; Atraxa, Praetors' Voice counted as one a turn, though it grows with your board$/);
  expect(timed.mill).toMatch(/would make it sooner; Ghost Vacuum counted as one a turn, though it grows with your board$/);
});

/** THE SIMULATED GAMES' SPREAD rides on the combat route (owner 2026-10-07). */
test("the combat route carries the fast and slow quarters of the simulated games", () => {
  const r = deck([{ class: "go-wide", cards: ["Goblin Rabblemaster"] }], 6) as DeckReport;
  (r.deckMath as { speed?: Record<string, unknown> }).speed = { combat: { turn: 16, early: 14, late: 17 } };
  expect(speedRoutes(r, () => undefined)[0]).toMatchObject({ kind: "combat", turn: 16, early: 14, late: 17 });
  (r.deckMath as { speed?: Record<string, unknown> }).speed = { combat: { early: 18 } };
  const [slow] = speedRoutes(r, () => undefined);
  expect(slow!.turn).toBeUndefined();
  expect(slow!.caveat).toBe("not timed: most of our test games never deal 120 by turn 20, though the fastest quarter do by turn 18");
});

/** A COMBO IS TIMED ONLY IF IT KILLS (#1084): twelve of 27 decks led "How you win" with a loop nothing
 *  in the deck turns into a win. */
const pay = [{ name: "Impact Tremors", on: ["A"], effect: "damage" }];
const comboMv: Record<string, number> = { A: 1, B: 1, C: 3, D: 3, Big1: 6, Big2: 6 };
const mvOf = (n: string) => comboMv[n];

test("the combo route times the cheapest combo that kills, not the cheapest combo", () => {
  const routes = speedRoutes(deck([], undefined, [
    { cards: ["A", "B"], result: "Infinite lifegain" },
    { cards: ["C", "D"], result: "Infinite ETB", payoffs: pay },
  ]), mvOf);
  expect(routes[0]).toMatchObject({ kind: "combo", label: "a combo: C + D", mana: 6, turn: 6 });
  expect(routes[0]!.needsFinisher).toBeUndefined();
});

test("a deck whose only combos kill nothing lists the route with no turn, and it never leads", () => {
  const routes = speedRoutes(deck([], undefined, [{ cards: ["A", "B"], result: "Infinite lifegain, Infinite turns" }]), mvOf);
  expect(routes).toHaveLength(1);
  expect(routes[0]).toMatchObject({ kind: "combo", label: "a combo: A + B", needsFinisher: true, caveat: "the loop needs a finisher: no card here was found to turn what it repeats into a win" });
  expect(routes[0]!.turn).toBeUndefined();
  expect(fastestRoute(routes)).toBeUndefined();
});

test("a payoff-less combo that wins by itself is timed and names the phrase", () => {
  const routes = speedRoutes(deck([], undefined, [{ cards: ["A", "B"], result: "Infinite mana, Infinite damage" }]), mvOf);
  expect(routes[0]).toMatchObject({ turn: 2, winsBy: "Infinite damage" });
  expect(routes[0]!.needsFinisher).toBeUndefined();
  expect(fastestRoute(routes)?.kind).toBe("combo");
});

test("a killing combo past the simulated rows is untimed and says what it costs", () => {
  const routes = speedRoutes(deck([], undefined, [{ cards: ["Big1", "Big2"], result: "Infinite mana, Win the game" }]), mvOf);
  expect(routes[0]!.turn).toBeUndefined();
  expect(routes[0]!.needsFinisher).toBeUndefined();
  expect(routes[0]!.caveat).toBe("not timed: its pieces cost 12 mana together, which half our test games have not reached by turn 8");
});

test("a win-the-game combo with no \"infinite\" in its result is a candidate, and beats a no-kill loop", () => {
  const m: Record<string, number> = { "Demonic Consultation": 1, "Thassa's Oracle": 2, A: 1, B: 1 };
  const routes = speedRoutes(deck([], undefined, [
    { cards: ["A", "B"], result: "Infinite lifegain" },
    { cards: ["Demonic Consultation", "Thassa's Oracle"], result: "Exile your library, Win the game" },
  ]), (n) => m[n]);
  expect(routes[0]).toMatchObject({ label: "a combo: Demonic Consultation + Thassa's Oracle", mana: 3, turn: 3, winsBy: "Win the game" });
  expect(routes[0]!.needsFinisher).toBeUndefined();
});

/** NO ROUTE FINISHES (#1223): Rani's combo repeats creature triggers nothing turns into a win and its
 *  drains take about 27 of 40. Each such route says what it lacks; the verdict needs every route to. */
const RANI_RESULT = "Infinite creature ETB, Infinite creature LTB, Infinite magecraft triggers";
const raniDrain: DrainSpeed = { perTurn: Array.from({ length: 20 }, () => 1.33), cards: ["Impact Tremors"], unbounded: [] };
const raniCombo = { cards: ["Dualcaster Mage", "Essence Flux"], result: RANI_RESULT };
const RANI_CLASSES = [{ class: "combo" }, { class: "burn" }];
const raniRoutes = () => speedRoutes(deck([{ class: "combo" }, { class: "burn" }], undefined, [raniCombo], raniDrain), (n) => mv[n]);

test("a loop with no finisher and drains short of 40 both say what they lack, and the verdict joins them", () => {
  const routes = raniRoutes();
  expect(routes[0]!.lacks).toBe("the Dualcaster Mage + Essence Flux loop repeats creature ETB, creature LTB and magecraft triggers, and no card here turns that into a win");
  expect(routes[1]!.lacks).toBe("its drains take about 27 of each opponent's 40 by turn 20");
  const verdict = noFinisher(routes, RANI_CLASSES)!;
  expect(verdict).toBe(`Nothing here was found that finishes a game: ${routes[0]!.lacks}; ${routes[1]!.lacks}.`);
  expect(verdict).toContain("creature ETB, creature LTB and magecraft triggers");
  expect(verdict).toContain("about 27 of each opponent's 40");
});

test("one route that might finish, or is simply not modelled, withholds the verdict", () => {
  const withAlt = speedRoutes(deck([{ class: "combo" }, { class: "burn" }, { class: "alt-win", cards: ["Simic Ascendancy"] }], undefined, [raniCombo], raniDrain), (n) => mv[n]);
  expect(withAlt.find((r) => r.kind === "alt-win")!.lacks).toBeUndefined();
  expect(noFinisher(withAlt, [...RANI_CLASSES, { class: "alt-win" }])).toBeUndefined();
  const killing = speedRoutes(deck([{ class: "combo" }, { class: "burn" }], undefined, [{ ...raniCombo, payoffs: pay }], raniDrain), (n) => mv[n]);
  expect(noFinisher(killing, RANI_CLASSES)).toBeUndefined();
  const oneShot = speedRoutes(deck([{ class: "combo" }, { class: "burn" }], undefined, [raniCombo]), (n) => mv[n]);
  expect(oneShot[1]!.lacks).toBeUndefined();
  expect(noFinisher(oneShot, RANI_CLASSES)).toBeUndefined();
  expect(noFinisher([], [])).toBeUndefined();
});

test("combat that finishes in the fastest quarter of games lacks nothing; with no turn at all it lacks the 120", () => {
  const r = deck([{ class: "go-wide", cards: ["Goblin Rabblemaster"] }], 6) as DeckReport;
  (r.deckMath as { speed?: Record<string, unknown> }).speed = { combat: { early: 18 } };
  expect(speedRoutes(r, () => undefined)[0]!.lacks).toBeUndefined();
  (r.deckMath as { speed?: Record<string, unknown> }).speed = { combat: {} };
  expect(speedRoutes(r, () => undefined)[0]!.lacks).toBe("its creatures deal the table's 120 in fewer than a quarter of our test games by turn 20");
});

test("a damage-preventing commander is named as what the damage routes lack", () => {
  const r = deck([{ class: "voltron", cards: ["Plate"] }, { class: "burn", cards: ["Leech"] }], 6) as DeckReport;
  (r.deckMath as { speed?: Record<string, unknown> }).speed = { prevented: "The Mindskinner", combat: {}, commander: { commander: "The Mindskinner" } };
  const routes = speedRoutes(r, () => undefined);
  expect(routes.map((x) => x.lacks)).toEqual(Array(3).fill("The Mindskinner prevents your damage to opponents"));
});

test("commander, poison and mill routes with no turn say what they miss", () => {
  const r = deck([{ class: "mill", cards: ["Ruin Crab"] }]) as DeckReport;
  (r.deckMath as { speed?: Record<string, unknown> }).speed = {
    commander: { commander: "Light-Paws" }, poison: { perTurn: [], cards: ["Blighted Agent"], unbounded: [] }, mill: { perTurn: [], cards: ["Ruin Crab"], unbounded: [] },
  };
  expect(speedRoutes(r, () => undefined).map((x) => [x.kind, x.lacks])).toEqual([
    ["commander", "Light-Paws does not deal 21 to each opponent by turn 20"],
    ["poison", "it does not put ten poison counters on every opponent by turn 20"],
    ["mill", "its mill cards do not empty every opponent's library by turn 20"],
  ]);
});

test("the clause is the verdict's lowercase body, and the verdict capitalises it", () => {
  const routes = raniRoutes();
  expect(noFinisherClause(routes, RANI_CLASSES)).toBe(`nothing here was found that finishes a game: ${routes[0]!.lacks}; ${routes[1]!.lacks}.`);
});

test("a damage-preventing commander is named once in the joined verdict, not once per route", () => {
  const r = deck([{ class: "voltron", cards: ["Plate"] }, { class: "burn", cards: ["Leech"] }], 6) as DeckReport;
  (r.deckMath as { speed?: Record<string, unknown> }).speed = { prevented: "The Mindskinner", combat: {}, commander: { commander: "The Mindskinner" } };
  const routes = speedRoutes(r, () => undefined);
  expect(noFinisher(routes, [{ class: "voltron" }, { class: "burn" }])).toBe("Nothing here was found that finishes a game: The Mindskinner prevents your damage to opponents.");
});

test("an undercounted source is unknown, not no: a short drain, mill or poison with an unbounded source lacks nothing", () => {
  const short: DrainSpeed = { perTurn: [1, 1], cards: ["Impact Tremors"], unbounded: ["Exsanguinate"] };
  const routes = speedRoutes(deck([{ class: "combo" }, { class: "burn" }], undefined, [raniCombo], short), (n) => mv[n]);
  expect(routes[1]!.lacks).toBeUndefined();
  expect(noFinisher(routes, RANI_CLASSES)).toBeUndefined();
  const r = deck([{ class: "mill", cards: ["Ruin Crab"] }]) as DeckReport;
  (r.deckMath as { speed?: Record<string, unknown> }).speed = {
    commander: undefined, poison: { perTurn: [], cards: ["Blighted Agent"], unbounded: ["Atraxa"] }, mill: { perTurn: [], cards: ["Ruin Crab"], unbounded: ["Bruvac"] },
  };
  expect(speedRoutes(r, () => undefined).map((x) => [x.kind, x.lacks])).toEqual([["poison", undefined], ["mill", undefined]]);
});

test("a plan class with no route of its own, or no known route kind, withholds the verdict", () => {
  // An alternate-win card with no mana value yields no route; the other routes lack, but that plan is unaccounted for.
  const noMv = speedRoutes(deck([{ class: "combo" }, { class: "burn" }, { class: "alt-win", cards: ["Mystery"] }], undefined, [raniCombo], raniDrain), (n) => mv[n]);
  expect(noMv.map((r) => r.kind)).toEqual(["combo", "burn"]);
  expect(noFinisher(noMv, [...RANI_CLASSES, { class: "alt-win" }])).toBeUndefined();
  // A combo class with no combos in the report has no combo route.
  const noCombo = speedRoutes(deck([{ class: "combo" }, { class: "burn" }], undefined, [], raniDrain), (n) => mv[n]);
  expect(noCombo.map((r) => r.kind)).toEqual(["burn"]);
  expect(noFinisher(noCombo, RANI_CLASSES)).toBeUndefined();
  expect(noFinisher(raniRoutes(), [...RANI_CLASSES, { class: "something-new" }])).toBeUndefined();
});

test("an unmodelled mill class, or a timed non-combo route beside lacking ones, withholds the verdict", () => {
  const unmodelled = speedRoutes(deck([{ class: "combo" }, { class: "mill", cards: ["Ruin Crab"] }], undefined, [raniCombo]), (n) => mv[n]);
  expect(unmodelled.find((r) => r.kind === "mill")!.lacks).toBeUndefined();
  expect(noFinisher(unmodelled, [{ class: "combo" }, { class: "mill" }])).toBeUndefined();
  const timed = speedRoutes(deck([{ class: "combo" }, { class: "burn" }], undefined, [raniCombo], { ...raniDrain, turn: 12 }), (n) => mv[n]);
  expect(noFinisher(timed, RANI_CLASSES)).toBeUndefined();
});

test("repeats reads a result phrase: Near-infinite and Infinite stripped, acronyms kept, deduped, three at most", () => {
  expect(repeats("Near-infinite mana")).toBe("mana");
  expect(repeats("Infinite ETB triggers")).toBe("ETB triggers");
  expect(repeats("Infinite Creature ETB, infinite creature ETB")).toBe("creature ETB");
  expect(repeats("Infinite a, Infinite b, Infinite c, Infinite d")).toBe("a, b and c");
});

test("a loop whose result kills one player is not called finisher-less", () => {
  for (const result of ["Target opponent loses the game", "Infinite damage to one opponent", "Near-infinite lifeloss for target opponent"]) {
    const routes = speedRoutes(deck([{ class: "combo" }], undefined, [{ cards: ["A", "B"], result: `Infinite mana, ${result}` }]), (n) => mv[n]);
    // A partial kill is not `comboWinsItself`, so the route stays a needsFinisher loop with its caveat.
    expect(routes[0]).toMatchObject({ kind: "combo", needsFinisher: true });
    expect(routes[0]!.lacks).toBeUndefined();
    expect(noFinisher(routes, [{ class: "combo" }])).toBeUndefined();
  }
});

test("with no simulation the combat route lacks nothing: no result is not a result of none", () => {
  const r = deck([{ class: "go-wide", cards: ["Goblin Rabblemaster"] }], 6) as DeckReport;
  (r.deckMath as { speed?: Record<string, unknown> }).speed = { combat: {} };
  expect(speedRoutes(r, () => undefined)[0]!.lacks).toBeDefined();
  delete (r as { manaAvailability?: unknown }).manaAvailability;
  expect(speedRoutes(r, () => undefined)[0]!.lacks).toBeUndefined();
});

test("a damage-preventing commander whose mill data exists leaves the preventer unnamed and the verdict withheld", () => {
  const r = deck([{ class: "voltron", cards: ["Plate"] }, { class: "burn", cards: ["Leech"] }], 6) as DeckReport;
  (r.deckMath as { speed?: Record<string, unknown> }).speed = { prevented: "The Mindskinner", combat: {}, commander: { commander: "The Mindskinner" }, mill: { perTurn: [], cards: ["The Mindskinner"], unbounded: [] } };
  const routes = speedRoutes(r, () => undefined);
  expect(routes.map((x) => x.lacks)).toEqual([undefined, undefined, undefined]);
  expect(noFinisher(routes, [{ class: "voltron" }, { class: "burn" }])).toBeUndefined();
});

test("phrases that only look like a kill still leave the loop finisher-less", () => {
  for (const result of [
    "Infinite damage to all creatures", "Near-infinite damage to all players", "Near-infinite lifeloss for all players",
    "Infinite mana, Infinite card draw for all players", "Prevent all combat damage target opponent would deal",
    "Deal lethal damage to all creatures opponents control with power 1 or greater",
    "Prevent all damage that would be dealt to you during an opponent's turn", "All players lose the game",
  ]) {
    const routes = speedRoutes(deck([{ class: "combo" }], undefined, [{ cards: ["A", "B"], result: `Infinite mana, ${result}` }]), (n) => mv[n]);
    expect(routes[0]!.lacks, result).toBeDefined();
    expect(noFinisher(routes, [{ class: "combo" }]), result).toBeDefined();
  }
});
