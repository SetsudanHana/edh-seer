import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { WinPlans } from "./WinPlans.js";

const WINCONS = {
  focus: 0.6, primary: "go-wide",
  classes: [
    { class: "go-wide", count: 3, share: 0.6, cards: ["Cleric 1", "Cleric 2"], payoffs: ["Payoff A"] },
    { class: "burn", count: 2, share: 0.4, cards: ["Payoff B", "Reducer"] },
  ],
} as never;

test("each win plan is a tile, the first picked to start with, and its cards read one plan at a time", () => {
  render(<WinPlans wincons={WINCONS} />);
  const plans = screen.getAllByTestId("win-plan");
  expect(plans[0]).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("Turns it into a win");
  fireEvent.click(plans[1]!);
  expect(plans[1]).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("Damage or drain · 2 cards");
});

/** HOW FAST, ON THE PLAN IT TIMES (owner, 2026-09-27: two walls of text for one question). */
test("each plan's tile carries the turn its route can win by, and the fastest leads", () => {
  const routes = [
    { kind: "combat", label: "attacking with a wide board", turn: 7, cards: [], caveat: "enough attacking power to kill one opponent" },
    { kind: "burn", label: "damage or drain", cards: [], caveat: "nothing in the report models how fast this route kills, so it has no turn" },
  ] as never;
  render(<WinPlans wincons={WINCONS} routes={routes} pressure={10.7} />);
  expect(screen.getByTestId("win-plans-headline")).toHaveTextContent("Fastest: attacking with a wide board, around turn 7. Spread about evenly across 2 plans.");
  const [wide, burn] = screen.getAllByTestId("win-plan");
  expect(wide).toHaveTextContent("Attacking with a wide boardturn 73 cards");
  expect(burn).toHaveTextContent("Damage or drainspeed not modelled2 cards");
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("Can win around turn 7; about 11 power of creatures in play by turn 5.");
  fireEvent.click(burn!);
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("No turn: nothing in the report models how fast this route kills");
});

/** AN ALTERNATE WIN IS TIMED BY ITS CAST, NOT ITS WIN (persona round 2026-09-27: "An alternate win
 *  condition · turn 1" read as a turn-1 win beside "Fastest … around turn 9"). */
test("an alternate win's tile carries no turn; the detail names the card and when it can be cast", () => {
  const wincons = { focus: 0.5, primary: "go-wide", classes: [
    { class: "go-wide", count: 3, share: 0.5, cards: ["A"] },
    { class: "alt-win", count: 2, share: 0.5, cards: ["Revel in Riches"] },
  ] } as never;
  const routes = [
    { kind: "combat", label: "attacking with a wide board", turn: 9, cards: [], caveat: "x" },
    { kind: "alt-win", label: "an alternate win: Vorpal Sword", turn: 1, cards: ["Revel in Riches", "Vorpal Sword"], card: "Vorpal Sword", caveat: "when it can be cast; its own win condition still has to be met after that" },
  ] as never;
  render(<WinPlans wincons={wincons} routes={routes} />);
  const [, alt] = screen.getAllByTestId("win-plan");
  // Mari's shape (persona round 2026-09-29): Vorpal Sword casts on turn 1 and wins on eight mana.
  expect(alt).toHaveTextContent("wins on its own condition");
  expect(alt).not.toHaveTextContent(/turn/);
  fireEvent.click(alt!);
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("Its cheapest card, Vorpal Sword, can be cast around turn 1; its own win condition still has to be met after that, so this is not when it wins.");
  expect(screen.getByTestId("win-plan-detail")).not.toHaveTextContent("Can win around");
});

/** A COMBO'S WIN IS ITS PAYOFF (persona round 2026-09-29, plan-seeker: the loop said what repeats
 *  and never what kills). The Combos page's "Wins through" cards lead the combo's detail; with none
 *  found, it says so rather than leaving the reader to assume one. */
test("a combo plan names the cards that turn its loop into a win, or says none was found", () => {
  const wincons = { focus: 0.5, primary: "combo", classes: [{ class: "combo", count: 2, share: 1, cards: ["Dualcaster Mage", "Essence Flux"] }] } as never;
  const route = (payoffs?: string[]) => [{ kind: "combo", label: "a combo: Dualcaster Mage + Essence Flux", turn: 4, cards: ["Dualcaster Mage", "Essence Flux"], caveat: "x", ...(payoffs ? { payoffs } : {}) }] as never;
  const { rerender } = render(<WinPlans wincons={wincons} routes={route(["Grim Guardian"])} />);
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("Turns it into a win");
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("Grim Guardian");
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("Can go infinite around turn 4");
  rerender(<WinPlans wincons={wincons} routes={route()} />);
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("No card here was found that turns what the loop repeats into a win.");
});

/** A VOLTRON PLAN READS ITS COMMANDER-DAMAGE TURN WHEN IT HAS ONE (#1056 R2), and the board's when the
 *  commander alone never gets there -- an untimed commander route must not hide a timed board. */
test("a voltron plan takes the commander-damage turn when timed, else the board's", () => {
  const voltron = { focus: 1, primary: "voltron", classes: [{ class: "voltron", count: 5, share: 1, cards: ["Plate"] }] } as never;
  const combat = { kind: "combat", label: "one big creature", turn: 12, cards: [], caveat: "enough attacking power to kill all three opponents" };
  const timed = { kind: "commander", label: "commander damage: Ox", turn: 8, cards: ["Ox"], caveat: "when it has dealt 21 to each opponent" };
  const untimed = { kind: "commander", label: "commander damage: Ox", cards: ["Ox"], caveat: "not timed: it does not deal 21 to all three opponents by turn 20" };
  const { unmount } = render(<WinPlans wincons={voltron} routes={[combat, timed] as never} pressure={10} />);
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("Can win around turn 8");
  unmount();
  render(<WinPlans wincons={voltron} routes={[combat, untimed] as never} pressure={10} />);
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("Can win around turn 12; about 10 power of creatures in play by turn 5.");
});

/** COMBAT'S SPREAD (owner 2026-10-07): the median simulated game with its fast and slow quarters. */
test("a combat plan shows the turn its fast and slow games get there", () => {
  const routes = [{ kind: "combat", label: "attacking with a wide board", turn: 16, early: 14, late: 17, cards: [], caveat: "" }] as never;
  render(<WinPlans wincons={WINCONS} routes={routes} />);
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("Can win around turn 16 (turn 14 in fast games, turn 17 in slow ones)");
});

/** A LOOP THAT NOTHING WINS WITH IS NOT TIMED (#1084): its tile says so, and a loop that wins by
 *  itself is not told it has no win. */
test("a combo no card here finishes says it needs a finisher, not that its speed is unmodelled", () => {
  const wincons = { focus: 0.5, primary: "combo", classes: [{ class: "combo", count: 2, share: 1, cards: ["A", "B"] }] } as never;
  const routes = [{ kind: "combo", label: "a combo: A + B", cards: ["A", "B"], needsFinisher: true, caveat: "the loop needs a finisher: no card here was found to turn what it repeats into a win" }] as never;
  render(<WinPlans wincons={wincons} routes={routes} />);
  expect(screen.getByTestId("win-plan")).toHaveTextContent("needs a finisher");
  expect(screen.getByTestId("win-plan")).not.toHaveTextContent("speed not modelled");
  // The caveat already says so; the detail does not print the "No card here was found" line as well.
  expect(screen.getByTestId("win-plan-detail")).not.toHaveTextContent("No card here was found that turns");
});

test("a combo that wins by itself says so, naming the result, and is not told it has no win", () => {
  const wincons = { focus: 0.5, primary: "combo", classes: [{ class: "combo", count: 2, share: 1, cards: ["A", "B"] }] } as never;
  const routes = [{ kind: "combo", label: "a combo: A + B", turn: 4, mana: 2, cards: ["A", "B"], winsBy: "Infinite damage", caveat: "x" }] as never;
  render(<WinPlans wincons={wincons} routes={routes} />);
  const d = screen.getByTestId("win-plan-detail");
  expect(d).toHaveTextContent("The loop wins by itself: Infinite damage.");
  expect(d).not.toHaveTextContent("No card here was found");
  expect(d).toHaveTextContent("Can go infinite around turn 4");
});
