import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { FirstTurns } from "./FirstTurns.js";
import type { FirstTurns as Model } from "../lib/first-turns.js";

const model: Model = {
  nonland: 60,
  commander: { name: "Krenko, Mob Boss", manaValue: 4, turn: 4, early: 3, late: 5 },
  steps: [
    { turn: 1, mana: 1, low: 1, high: 1, castable: 8, jobs: [{ job: "ramp", cards: [{ name: "Sol Ring", manaValue: 1 }] }] },
    { turn: 2, mana: 2, low: 2, high: 3, castable: 25, jobs: [{ job: "plan", cards: ["A", "B", "C", "D", "E", "F", "G", "H"].map((name) => ({ name, manaValue: 2 })) }] },
    { turn: 3, mana: 3, low: 2, high: 4, castable: 40, jobs: [] },
    { turn: 4, mana: 4, low: 3, high: 5, castable: 52, jobs: [] },
    { turn: 5, mana: 5, low: 4, high: 6, castable: 57, jobs: [] },
  ],
};

test("the first five turns are five tiles, and the cards are read one turn at a time", () => {
  render(<FirstTurns model={model} />);
  expect(screen.getByTestId("first-turns-headline")).toHaveTextContent(
    "By turn 3 you can cast 40 of your 60 spells, and by turn 5, 57. Your commander, Krenko, Mob Boss (4 mana), comes down on turn 4 in half your games.",
  );
  expect(screen.getAllByTestId("first-turn-tile")).toHaveLength(5);
  expect(screen.getByRole("button", { name: "Turn 2: 2 mana, 8 new spells" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Turn 4: 4 mana, 0 new spells, commander" })).toBeInTheDocument();
  // Turn 3 to start, and only its cards.
  expect(screen.getByRole("button", { name: /^Turn 3:/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("first-turn")).toHaveTextContent("Nothing new costs 3");
  expect(screen.queryByText("Sol Ring")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Turn 2:/ }));
  expect(screen.getByTestId("first-turn")).toHaveTextContent("Turn 2 · 2 mana (2–3 in slow to fast games)");
  expect(screen.getByTestId("first-turn-job")).toHaveTextContent("win plan · 8");
  expect(screen.queryByText("G")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "+2 more" }));
  expect(screen.getByText("H")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Turn 4:/ }));
  expect(screen.getByTestId("first-turn")).toHaveTextContent("your commander, Krenko, Mob Boss");
  expect(screen.getByText(/whether or not it is in your hand/)).toBeInTheDocument();
});

test("Play steps through every turn once, on request", async () => {
  vi.useFakeTimers();
  try {
    render(<FirstTurns model={model} />);
    fireEvent.click(screen.getByRole("button", { name: "Play turns 1 to 5" }));
    expect(screen.getByRole("button", { name: /^Turn 1:/ })).toHaveAttribute("aria-pressed", "true");
    for (let i = 0; i < 5; i++) await act(async () => { vi.advanceTimersByTime(1100); });
    expect(screen.getByRole("button", { name: /^Turn 5:/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Play turns 1 to 5" })).toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});
