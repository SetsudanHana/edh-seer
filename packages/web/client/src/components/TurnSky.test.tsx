import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { buildEngineModel } from "../lib/engine-model.js";
import type { FirstTurns } from "../lib/first-turns.js";
import { TurnSky } from "./TurnSky.js";

// `castable` counts every spell cheap enough by then, as `firstTurns` does: earlier turns included.
const step = (turn: number, names: string[], castable: number) => ({ turn, mana: turn, low: turn, high: turn + 1, castable, jobs: [{ job: "engine" as never, cards: names.map((name) => ({ name, manaValue: turn })) }] });
const TURNS: FirstTurns = { nonland: 10, steps: [step(1, ["Cleric 1"], 1), step(2, ["Cleric 2", "Reducer"], 3), step(3, ["Payoff A"], 4), step(4, ["Payoff B"], 5), step(5, [], 5)] };

test("the sky lights the cards castable by the turn picked, counting earlier turns", () => {
  const { report, graph } = engineDeck();
  const m = buildEngineModel(report, graph);
  const { rerender } = render(<TurnSky model={m} turns={TURNS} turn={3} />);
  // The tiles' own count (`castable`): the four cards castable by turn 3.
  expect(screen.getByText(/^Turn 3: 4 spells castable, lit/)).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /Lit: Turn 3/ })).toBeInTheDocument();
  rerender(<TurnSky model={m} turns={TURNS} turn={1} />);
  expect(screen.getByText(/^Turn 1: 1 spell castable, lit/)).toBeInTheDocument();
});

/** ONLY WHAT THIS TURN ADDS (persona round, 2026-09-27: 281 lines by turn 5 were a hairball). */
test("each turn draws only the links it adds", () => {
  const { report, graph } = engineDeck();
  const m = buildEngineModel(report, graph);
  const { container, rerender } = render(<TurnSky model={m} turns={TURNS} turn={4} />);
  const count = () => container.querySelectorAll("[data-testid=sky-lit-lines] line").length;
  const t4 = count();
  rerender(<TurnSky model={m} turns={TURNS} turn={5} />);
  // Turn 5 adds no card, so it adds no link.
  expect(count()).toBe(0);
  expect(t4).toBeGreaterThan(0);
});
