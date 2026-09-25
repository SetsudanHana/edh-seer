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

test("a big group shows twelve chips and names the rest until asked for all", async () => {
  const { report, graph } = engineDeck();
  const edges = (report as unknown as { edges: unknown[] }).edges;
  for (let i = 1; i <= 10; i++) {
    const name = `Extra Cleric ${i}`;
    (report.cards as unknown as { name: string }[]).push({ name, isCommander: false, score: 1 } as never);
    (graph.nodes as unknown as { id: string }[]).push({ id: name, label: name, copies: 1, types: ["creature"], subtypes: [], supertypes: [], colors: [], cmc: 2, roles: [] } as never);
    for (const p of ["Payoff A", "Payoff B"]) edges.push({ a: name, b: p, score: 1, reasons: [{ producer: name, consumer: p, tag: "scales:cleric", text: `While you control ${name}, ${p} counts it` }] });
  }
  render(<EnginesView report={report} graph={graph} selected={null} onSelect={vi.fn()} />);
  const group = screen.getByRole("heading", { name: "Counts your Clerics" }).closest("article")!;
  expect(within(group).queryByRole("button", { name: "Extra Cleric 9" })).toBeNull();
  expect(within(group).getByText(/and 6 more:/)).toBeInTheDocument();
  await userEvent.setup().click(within(group).getByRole("button", { name: "Show all 18" }));
  expect(within(group).getByRole("button", { name: "Extra Cleric 9" })).toBeInTheDocument();
});
