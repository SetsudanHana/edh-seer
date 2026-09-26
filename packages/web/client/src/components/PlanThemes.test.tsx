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

/** ONE NAME FOR THE MAIN THEME (appeal review 2026-09-26): the group that IS the main theme takes
 *  the name Glance gives it, leads, and says so; a group about the same subject says it is part of
 *  it; and where no group meets it, the page says so in words. */
test("the main theme's own group takes its name, leads and says so, with both counts named", () => {
  const { report, graph } = engineDeck();
  render(<PlanThemes report={report} graph={graph} main={{ name: "Cleric typal", tag: "scales:cleric", count: 9, nonland: 16 }} />);
  const themes = screen.getAllByRole("heading", { level: 4 }).filter((h) => h.id.startsWith("theme-"));
  expect(themes[0]!.textContent).toBe("Cleric typal");
  const card = themes[0]!.closest("article")!;
  expect(within(card).getByText("Your main theme")).toBeInTheDocument();
  expect(card.textContent).toMatch(/\d+ cards linked here/);
  expect(card.textContent).toContain("9 of your 16 nonland cards are built for it");
  expect(screen.queryByRole("heading", { name: "Counts your Clerics" })).toBeNull();
  expect(screen.getByText("Part of your main theme, Cleric typal")).toBeInTheDocument();
});

test("a main theme no group meets is named in words above the themes", () => {
  const { report, graph } = engineDeck();
  render(<PlanThemes report={report} graph={graph} main={{ name: "Blink", tag: "etb-refire", count: 12, nonland: 60 }} />);
  expect(screen.getByText(/Your main theme, by what your cards/).textContent).toMatch(/is Blink \(12 of 60 nonland cards\)/);
  expect(screen.queryByText("Your main theme")).toBeNull();
});

test("the second theme's own group takes its name and says it is the second theme", () => {
  const { report, graph } = engineDeck();
  render(<PlanThemes report={report} graph={graph} main={{ name: "Blink", tag: "etb-refire", count: 12, nonland: 60, second: { name: "Cleric typal", tag: "scales:cleric" } }} />);
  const card = screen.getByRole("heading", { name: "Cleric typal" }).closest("article")!;
  expect(within(card).getByText("Your second theme")).toBeInTheDocument();
});
