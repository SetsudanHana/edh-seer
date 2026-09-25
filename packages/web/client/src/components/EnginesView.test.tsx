import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { EnginesView } from "./EnginesView.js";

function view(selected: string | null = null) {
  const { report, graph } = engineDeck();
  const onSelect = vi.fn();
  render(<EnginesView report={report} graph={graph} selected={selected} onSelect={onSelect} />);
  return onSelect;
}

test("says what the deck does, then the best pairs, the cut candidates and the groups", () => {
  view();
  expect(screen.getByText(/Your deck mostly does/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "The pairs that work best together" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Payoff A + Payoff B" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Cards doing the least here" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Vanilla" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Counts your Clerics" })).toBeInTheDocument();
});

test("removal is compared with its own kind, not listed as a cut", () => {
  view();
  expect(screen.queryByRole("heading", { name: "Doom Blade" })).toBeNull();
  expect(screen.getByText(/Removal · 1/)).toBeInTheDocument();
});

test("tapping a card selects it", async () => {
  const onSelect = view();
  const group = screen.getByRole("heading", { name: "Counts your Clerics" }).closest("article")!;
  await userEvent.setup().click(within(group).getByRole("button", { name: "Cleric 3" }));
  expect(onSelect).toHaveBeenCalledWith("Cleric 3");
});

test("a selected card lights its partners and fades the rest", () => {
  view("Payoff A");
  expect(screen.getByText(/lit below; everything else is faded/)).toBeInTheDocument();
  const clerics = screen.getByRole("heading", { name: "Counts your Clerics" }).closest("article")!;
  expect(within(clerics).getByRole("button", { name: "Cleric 1" }).className).not.toMatch(/opacity-30/);
  const helpers = screen.getByRole("heading", { name: "Make cards cheaper" }).closest("article")!;
  expect(within(helpers).getByRole("button", { name: "Reducer" }).className).toMatch(/opacity-30/);
  expect(within(clerics).getAllByRole("button", { name: "Payoff A" })[0]).toHaveAttribute("aria-pressed", "true");
});
