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
test("each win plan can be shown on the deck's sky, the first to start with", () => {
  const { report, graph } = engineDeck();
  render(<SkyContext.Provider value={buildEngineModel(report, graph)}><WinPlans wincons={WINCONS} /></SkyContext.Provider>);
  const plans = screen.getAllByRole("button", { name: /on the sky/ });
  expect(plans[0]).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText(/: its 3 cards lit/)).toBeInTheDocument();
  fireEvent.click(plans[1]!);
  expect(plans[1]).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText(/: its 2 cards lit/)).toBeInTheDocument();
});

test("outside a report there is no sky, and the plans are plain", () => {
  render(<WinPlans wincons={WINCONS} />);
  expect(screen.queryByRole("button", { name: /on the sky/ })).toBeNull();
  expect(screen.queryByRole("img", { name: /as a sky/ })).toBeNull();
});
