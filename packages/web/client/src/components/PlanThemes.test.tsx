import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { buildEngineModel } from "../lib/engine-model.js";
import { PlanThemes } from "./PlanThemes.js";

function view() {
  const { report, graph } = engineDeck();
  const onOpenCard = vi.fn();
  render(<PlanThemes report={report} graph={graph} onOpenCard={onOpenCard} />);
  return onOpenCard;
}

const row = (name: string) => screen.getByRole("heading", { name }).closest("li")!;

/** ONE ROW PER THEME (owner, 2026-09-27: "less is more", "rely more on data visualisation than the
 *  text"): its name, a bar with one count, and its key cards; the rest on a tap. */
test("says what the deck does as one row per theme, each with one count", () => {
  view();
  expect(screen.getByRole("heading", { name: "What your deck does" })).toBeInTheDocument();
  // A theme made of the same cards as a row above it is a chip under that row (option B).
  const folded = screen.queryAllByTestId("theme-also").flatMap((a) => within(a).getAllByRole("button"));
  expect(screen.getAllByTestId("theme-row").length + folded.length).toBeGreaterThan(1);
  expect(row("Cleric tribal").textContent).toMatch(/\d+ cards/);
  // The pairs are no longer a section here: the best cards lead "Cards that carry it".
  expect(screen.queryByRole("heading", { name: "The pairs that work best together" })).toBeNull();
});

test("a closed row names no cards; opened, it lists them, key cards first and none twice", async () => {
  view();
  const theme = row("Cleric tribal");
  expect(within(theme).queryByRole("button", { name: /Cleric 1/ })).toBeNull();
  await userEvent.setup().click(within(theme).getByTestId("theme-row"));
  expect(within(theme).getAllByRole("button", { name: /^Payoff A/ })).toHaveLength(1);
  expect(within(theme).getByRole("button", { name: /Cleric 1/ })).toBeInTheDocument();
});

test("tapping a card in an open theme opens it in the one-card view", async () => {
  const onOpenCard = view();
  const user = userEvent.setup();
  const theme = row("Cleric tribal");
  await user.click(within(theme).getByTestId("theme-row"));
  await user.click(within(theme).getByRole("button", { name: /Cleric 3/ }));
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
  const user = userEvent.setup();
  const theme = row("Cleric tribal");
  await user.click(within(theme).getByTestId("theme-row"));
  expect(within(theme).queryByRole("button", { name: /Extra Cleric 9/ })).toBeNull();
  await user.click(within(theme).getByRole("button", { name: /^Show all \d+$/ }));
  expect(within(theme).getByRole("button", { name: /Extra Cleric 9/ })).toBeInTheDocument();
});

test("the supporting groups are folded until asked for", async () => {
  view();
  expect(screen.queryByRole("heading", { name: "Cost reducers" })).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: /^Supporting groups · \d+$/ }));
  expect(screen.getByRole("heading", { name: "Cost reducers" })).toBeInTheDocument();
});

/** ONE NAME FOR THE MAIN THEME (appeal review 2026-09-26): the group that IS the main theme takes
 *  the name Glance gives it, leads, and says so; where no group meets it, the page says so. */
test("the main theme's own group takes its name, leads and says so", () => {
  const { report, graph } = engineDeck();
  render(<PlanThemes report={report} graph={graph} main={{ name: "Clerics", tag: "scales:cleric", count: 9, nonland: 16 }} />);
  const themes = screen.getAllByRole("heading", { level: 4 }).filter((h) => h.id.startsWith("theme-"));
  expect(themes[0]!.textContent).toBe("Clerics");
  expect(within(themes[0]!.closest("li")!).getByText("main theme")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Cleric tribal" })).toBeNull();
});

test("a main theme no group meets is named in words above the themes", () => {
  const { report, graph } = engineDeck();
  render(<PlanThemes report={report} graph={graph} main={{ name: "Blink", tag: "etb-refire", count: 12, nonland: 60 }} />);
  expect(screen.getByText(/Your main theme is/).textContent).toMatch(/Blink \(12 of 60 nonland cards\)/);
  expect(screen.queryByText("main theme")).toBeNull();
});

test("the second theme's own group takes its name and says it is the second theme", () => {
  const { report, graph } = engineDeck();
  render(<PlanThemes report={report} graph={graph} main={{ name: "Blink", tag: "etb-refire", count: 12, nonland: 60, second: { name: "Cleric tribal", tag: "scales:cleric" } }} />);
  expect(within(row("Cleric tribal")).getByText("second theme")).toBeInTheDocument();
});

/** OPTION B (owner, 2026-09-27: "only if we are able to click and jump to see the cards"): a theme
 *  made of the same cards as one above it folds under that row as a chip; the chip opens its own
 *  cards in place, and a card there opens like any other. */
test("a theme made of the same cards folds under the row it repeats, and its chip opens its cards", async () => {
  const { report, graph } = engineDeck();
  const model = buildEngineModel(report, graph);
  const themes = model.groups.filter((g) => !g.helper);
  expect(themes.length).toBeGreaterThan(1);
  const [first, second] = themes as [typeof themes[0], typeof themes[0]];
  second.sameAs = { name: first.name, extra: [], missing: [] };
  const onOpenCard = vi.fn();
  render(<PlanThemes report={report} graph={graph} model={model} onOpenCard={onOpenCard} />);
  expect(screen.queryByRole("heading", { name: second.name })).toBeNull();
  const also = within(row(first.name)).getByTestId("theme-also");
  const chip = within(also).getByRole("button", { name: new RegExp(second.name, "i") });
  expect(chip).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(chip);
  expect(chip).toHaveAttribute("aria-expanded", "true");
  const list = within(also).getByLabelText(`${second.name}: its cards`);
  const first_card = within(list).getAllByRole("button")[0]!;
  await userEvent.click(first_card);
  expect(onOpenCard).toHaveBeenCalled();
});

test("the main theme never folds under another row", () => {
  const { report, graph } = engineDeck();
  const model = buildEngineModel(report, graph);
  const themes = model.groups.filter((g) => !g.helper);
  const cleric = themes.find((g) => g.tag === "scales:cleric")!;
  const other = themes.find((g) => g !== cleric)!;
  cleric.sameAs = { name: other.name, extra: [], missing: [] };
  render(<PlanThemes report={report} graph={graph} model={model} main={{ name: "Clerics", tag: "scales:cleric", count: 9, nonland: 16 }} />);
  expect(screen.getByRole("heading", { name: "Clerics" })).toBeInTheDocument();
});
