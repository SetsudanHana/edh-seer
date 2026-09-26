import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { PlanThemes } from "./PlanThemes.js";

function view() {
  const { report, graph } = engineDeck();
  const onOpenCard = vi.fn();
  render(<PlanThemes report={report} graph={graph} onOpenCard={onOpenCard} />);
  return onOpenCard;
}

test("says what the deck does as themes with their cards, then the best pairs", () => {
  view();
  expect(screen.getByRole("heading", { name: "What your deck does" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Counts your Clerics" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "The pairs that work best together" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Payoff A + Payoff B" })).toBeInTheDocument();
});

test("a theme leads with its key cards as images, and the cards that set them off follow once", () => {
  view();
  const theme = screen.getByRole("heading", { name: "Counts your Clerics" }).closest("article")!;
  const keys = within(theme).getByRole("list", { name: "Counts your Clerics: key cards" });
  // Card faces (the fixture has no art, so each is a named frame).
  expect(within(keys).getAllByRole("listitem").length).toBeGreaterThan(0);
  expect(within(keys).getByText("Payoff A")).toBeInTheDocument();
  // A key card is not listed again among the cards that set it off.
  expect(within(theme).queryByRole("button", { name: /^Payoff A/ })).toBeNull();
  expect(within(theme).getByRole("button", { name: /Cleric 1/ })).toBeInTheDocument();
});

test("tapping a card opens it in the one-card view", async () => {
  const onOpenCard = view();
  const theme = screen.getByRole("heading", { name: "Counts your Clerics" }).closest("article")!;
  await userEvent.setup().click(within(theme).getByRole("button", { name: /Cleric 3/ }));
  expect(onOpenCard).toHaveBeenCalledWith("Cleric 3");
});

test("a big theme shows its first cards and the rest behind Show all", async () => {
  const { report, graph } = engineDeck();
  const edges = (report as unknown as { edges: unknown[] }).edges;
  for (let i = 1; i <= 10; i++) {
    const name = `Extra Cleric ${i}`;
    (report.cards as unknown as { name: string }[]).push({ name, isCommander: false, score: 1 } as never);
    (graph.nodes as unknown as { id: string }[]).push({ id: name, label: name, copies: 1, types: ["creature"], subtypes: [], supertypes: [], colors: [], cmc: 2, roles: [] } as never);
    for (const p of ["Payoff A", "Payoff B"]) edges.push({ a: name, b: p, score: 1, reasons: [{ producer: name, consumer: p, tag: "scales:cleric", text: `While you control ${name}, ${p} counts it` }] });
  }
  render(<PlanThemes report={report} graph={graph} onOpenCard={vi.fn()} />);
  const theme = screen.getByRole("heading", { name: "Counts your Clerics" }).closest("article")!;
  expect(within(theme).queryByRole("button", { name: /Extra Cleric 9/ })).toBeNull();
  await userEvent.setup().click(within(theme).getByRole("button", { name: "Show all 18" }));
  expect(within(theme).getByRole("button", { name: /Extra Cleric 9/ })).toBeInTheDocument();
});

test("the helpers are folded until asked for", async () => {
  view();
  expect(screen.queryByRole("heading", { name: "Make cards cheaper" })).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: /^Show the helpers: make cards cheaper/ }));
  expect(screen.getByRole("heading", { name: "Make cards cheaper" })).toBeInTheDocument();
});
