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
  expect(burn).toHaveTextContent("Damage or drainno turn estimate2 cards");
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("Can win around turn 7; about 11 power of creatures in play by turn 5.");
  fireEvent.click(burn!);
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("No turn: nothing in the report models how fast this route kills");
});

/** AN ALTERNATE WIN IS TIMED BY ITS CAST, NOT ITS WIN (persona round 2026-09-27: "An alternate win
 *  condition · turn 1" read as a turn-1 win beside "Fastest … around turn 9"). */
test("an alternate win's tile says when its card can be cast, not a bare turn", () => {
  const wincons = { focus: 0.5, primary: "go-wide", classes: [
    { class: "go-wide", count: 3, share: 0.5, cards: ["A"] },
    { class: "alt-win", count: 2, share: 0.5, cards: ["Revel in Riches"] },
  ] } as never;
  const routes = [
    { kind: "combat", label: "attacking with a wide board", turn: 9, cards: [], caveat: "x" },
    { kind: "alt-win", label: "an alternate win: Revel in Riches", turn: 1, cards: ["Revel in Riches"], caveat: "when it can be cast; its own win condition still has to be met after that" },
  ] as never;
  render(<WinPlans wincons={wincons} routes={routes} />);
  const [, alt] = screen.getAllByTestId("win-plan");
  expect(alt).toHaveTextContent("cast by turn 1");
  expect(alt).not.toHaveTextContent(/^.*\bturn 1\b.*turn 1/);
  fireEvent.click(alt!);
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("Its cheapest card can be cast around turn 1; its own win condition still has to be met after that.");
  expect(screen.getByTestId("win-plan-detail")).not.toHaveTextContent("Can win around");
});
