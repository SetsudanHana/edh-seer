import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { buildEngineModel } from "../lib/engine-model.js";
import type { FirstTurns } from "../lib/first-turns.js";
import { TurnSky } from "./TurnSky.js";

const step = (turn: number, names: string[]) => ({ turn, mana: turn, low: turn, high: turn + 1, castable: names.length, jobs: [{ job: "engine" as never, cards: names.map((name) => ({ name, manaValue: turn })) }] });
const TURNS: FirstTurns = { nonland: 10, steps: [step(1, ["Cleric 1"]), step(2, ["Cleric 2", "Reducer"]), step(3, ["Payoff A"]), step(4, ["Payoff B"]), step(5, [])] };

test("the sky lights the cards castable by the turn picked, counting earlier turns", () => {
  const { report, graph } = engineDeck();
  render(<TurnSky model={buildEngineModel(report, graph)} turns={TURNS} />);
  // Turn 3 to start: the four cards castable by then.
  expect(screen.getByRole("button", { name: "T3" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText(/^Turn 3, with 3 mana in a typical game: 4 cards castable by now/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "T1" }));
  expect(screen.getByText(/^Turn 1, with 1 mana in a typical game: 1 card castable by now/)).toBeInTheDocument();
});

test("Play steps through every turn once, on request", async () => {
  vi.useFakeTimers();
  try {
    const { report, graph } = engineDeck();
    render(<TurnSky model={buildEngineModel(report, graph)} turns={TURNS} />);
    fireEvent.click(screen.getByRole("button", { name: "Play turns 1 to 5" }));
    expect(screen.getByRole("button", { name: "T1" })).toHaveAttribute("aria-pressed", "true");
    for (let i = 0; i < 5; i++) await act(async () => { vi.advanceTimersByTime(1100); });
    expect(screen.getByRole("button", { name: "T5" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Play turns 1 to 5" })).toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});
