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
