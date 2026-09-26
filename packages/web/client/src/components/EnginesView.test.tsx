import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { EnginesView } from "./EnginesView.js";

function view(selected: string | null = null) {
  const { report, graph } = engineDeck();
  const onSelect = vi.fn();
  render(<EnginesView report={report} graph={graph} selected={selected} onSelect={onSelect} />);
  return onSelect;
}

test("the Overview keeps the cut candidates and the jobs, and points to Game plan for the rest", () => {
  view();
  expect(screen.getByText(/are in the report’s/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Cards doing the least here" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Vanilla" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "The pairs that work best together" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "What your deck does" })).toBeNull();
});

test("removal is compared with its own kind, not listed as a cut", () => {
  view();
  expect(screen.queryByRole("heading", { name: "Doom Blade" })).toBeNull();
  // On its job's shelf, as a card with the number of cards it works with under it.
  const shelf = screen.getByRole("list", { name: "Removal" });
  expect(within(shelf).getByText("Doom Blade")).toBeInTheDocument();
  expect(within(shelf).getByTitle(/^Works with \d+ other cards?$/)).toBeInTheDocument();
});

test("a job's shelf shows its cards, not a line of names and mana symbols", () => {
  view();
  expect(screen.getByRole("heading", { name: "Cards judged by their job" })).toBeInTheDocument();
  expect(screen.queryByText(/Removal · 1/)).toBeNull();
});

test("a card that only feeds others says so instead of offering a best reason", () => {
  view();
  const cleric = screen.getAllByRole("heading", { name: /^Cleric \d$/ })[0]!.closest("article")!;
  expect(within(cleric).getByText(/Who uses it/)).toBeInTheDocument();
  expect(within(cleric).getByText(/Payoff [AB] and Payoff [AB]\./)).toBeInTheDocument();
  expect(within(cleric).getByText(/None of the links found here use its own abilities/)).toBeInTheDocument();
  expect(within(cleric).queryByText(/Best reason to keep it/)).toBeNull();
});

test("a cut used by exactly the same cards as one above says so instead of listing them again", () => {
  view();
  expect(screen.getByText(/can stand in for another: cutting one leaves the rest doing the same job/)).toBeInTheDocument();
});

