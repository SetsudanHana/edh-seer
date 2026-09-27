import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { FirstTurns } from "./FirstTurns.js";
import type { FirstTurns as Model } from "../lib/first-turns.js";

const model: Model = {
  nonland: 60,
  commander: { name: "Krenko, Mob Boss", manaValue: 4, turn: 4, early: 3, late: 5 },
  steps: [
    { turn: 1, mana: 1, low: 1, high: 1, castable: 8, jobs: [{ job: "ramp", cards: [{ name: "Sol Ring", manaValue: 1 }] }] },
    { turn: 2, mana: 2, low: 2, high: 3, castable: 25, jobs: [{ job: "plan", cards: ["A", "B", "C", "D", "E", "F"].map((name) => ({ name, manaValue: 2 })) }] },
    { turn: 3, mana: 3, low: 2, high: 4, castable: 40, jobs: [] },
    { turn: 4, mana: 4, low: 3, high: 5, castable: 52, jobs: [] },
    { turn: 5, mana: 5, low: 4, high: 6, castable: 57, jobs: [] },
  ],
};

test("the first five turns say what becomes castable, when the commander lands, and what is not counted", () => {
  render(<FirstTurns model={model} />);
  expect(screen.getByTestId("first-turns-headline")).toHaveTextContent(
    "By turn 3 you can cast 40 of your 60 spells, and by turn 5, 57. Your commander, Krenko, Mob Boss (4 mana), comes down on turn 4 in half your games.",
  );
  const [t1, t2, t3, t4] = screen.getAllByTestId("first-turn");
  expect(t1).toHaveTextContent("Turn 1 · 1 mana");
  expect(t1).toHaveTextContent("1 ramp: Sol Ring");
  expect(t2).toHaveTextContent("2–3 in slow to fast games");
  expect(t2).toHaveTextContent("6 win plan: A · B · C · D +2 more");
  fireEvent.click(within(t2!).getByRole("button", { name: "+2 more" }));
  expect(t2).toHaveTextContent("A · B · C · D · E · F");
  expect(t3).toHaveTextContent("Nothing new costs 3");
  expect(t4).toHaveTextContent("commander: Krenko, Mob Boss");
  expect(screen.getByText(/whether it is in your hand, and its colours, are not counted/)).toBeInTheDocument();
});
