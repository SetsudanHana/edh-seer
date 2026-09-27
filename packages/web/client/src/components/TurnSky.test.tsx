import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { buildEngineModel } from "../lib/engine-model.js";
import type { FirstTurns } from "../lib/first-turns.js";
import { TurnSky } from "./TurnSky.js";

// `castable` counts every spell cheap enough by then, as `firstTurns` does: earlier turns included.
const step = (turn: number, names: string[], castable: number) => ({ turn, mana: turn, low: turn, high: turn + 1, castable, jobs: [{ job: "engine" as never, cards: names.map((name) => ({ name, manaValue: turn })) }] });
const TURNS: FirstTurns = { nonland: 10, steps: [step(1, ["Cleric 1"], 1), step(2, ["Cleric 2", "Reducer"], 3), step(3, ["Payoff A"], 4), step(4, ["Payoff B"], 5), step(5, [], 5)] };

test("the sky lights the cards castable by the turn picked, counting earlier turns", () => {
  const { report, graph } = engineDeck();
  render(<TurnSky model={buildEngineModel(report, graph)} turns={TURNS} />);
  // Turn 3 to start: the four cards castable by then.
  expect(screen.getByRole("button", { name: "T3" })).toHaveAttribute("aria-pressed", "true");
  // The list's own count (`castable`), and what "castable" means here.
  expect(screen.getByText(/^Turn 3, with 3 mana in a typical game: 4 spells cheap enough to cast by now, lit \(by cost, not by what is in your hand\)/)).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /Lit: Turn 3/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "T1" }));
  expect(screen.getByText(/^Turn 1, with 1 mana in a typical game: 1 spell cheap enough to cast by now/)).toBeInTheDocument();
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

/** ONLY WHAT THIS TURN ADDS (persona round, 2026-09-27: 281 lines by turn 5 were a hairball). */
test("each turn draws only the links it adds", () => {
  const { report, graph } = engineDeck();
  const m = buildEngineModel(report, graph);
  const { container } = render(<TurnSky model={m} turns={TURNS} />);
  const count = () => container.querySelectorAll("[data-testid=sky-lit-lines] line").length;
  fireEvent.click(screen.getByRole("button", { name: "T4" }));
  const t4 = count();
  fireEvent.click(screen.getByRole("button", { name: "T5" }));
  // Turn 5 adds no card, so it adds no link.
  expect(count()).toBe(0);
  expect(screen.getByText(/no new links between them this turn/)).toBeInTheDocument();
  expect(t4).toBeGreaterThan(0);
});
