import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { buildEngineModel } from "../lib/engine-model.js";
import { SkyContext } from "./DeckSky.js";
import { WinPlans } from "./WinPlans.js";

const WINCONS = {
  focus: 0.6, primary: "go-wide",
  classes: [
    { class: "go-wide", count: 3, share: 0.6, cards: ["Cleric 1", "Cleric 2"], payoffs: ["Payoff A"] },
    { class: "burn", count: 2, share: 0.4, cards: ["Payoff B", "Reducer"] },
  ],
} as never;

/** THE PLAN ON THE DECK'S SKY (owner, 2026-09-27): pick a plan, and its cards light. */
test("each win plan is a tile, the first picked to start with, and its cards light the sky", () => {
  const { report, graph } = engineDeck();
  render(<SkyContext.Provider value={buildEngineModel(report, graph)}><WinPlans wincons={WINCONS} /></SkyContext.Provider>);
  const plans = screen.getAllByTestId("win-plan");
  expect(plans[0]).toHaveAttribute("aria-pressed", "true");
  // The plan's cards, then its finisher, counted apart as the plan lists them.
  expect(screen.getByText(/: its 2 cards and 1 finisher lit/)).toBeInTheDocument();
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("Turns it into a win");
  fireEvent.click(plans[1]!);
  expect(plans[1]).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText(/: its 2 cards lit/)).toBeInTheDocument();
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
  expect(burn).toHaveTextContent("Damage or drainnot timed2 cards");
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("Can win around turn 7; 10.7 power on board by turn 5.");
  fireEvent.click(burn!);
  expect(screen.getByTestId("win-plan-detail")).toHaveTextContent("No turn: nothing in the report models how fast this route kills");
});

test("outside a report there is no sky, and the plans are plain", () => {
  render(<WinPlans wincons={WINCONS} />);
  expect(screen.getAllByTestId("win-plan")).toHaveLength(2);
  expect(screen.queryByRole("img", { name: /as a sky/ })).toBeNull();
});
