import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { CutChoice } from "../lib/cut-choice.js";
import { CutList } from "./CutList.js";

const cut = (name: string, extra: Partial<CutChoice> = {}): CutChoice =>
  ({ name, manaValue: 2, keeps: [], unmet: [], reasons: ["only 1 card connects to it"], twins: [], ...extra });

test("a cut says why it is here and what argues it stays", () => {
  render(<CutList cuts={[cut("Sidekick", { keeps: ["its best edge is on your main theme"], unmet: ["its condition needs a Cleric, and nothing in the deck provides that"] })]} slack={[]} />);
  const row = screen.getByRole("heading", { name: /Sidekick/ }).closest("li")!;
  expect(within(row).getByText("Only 1 card connects to it.")).toBeInTheDocument();
  expect(within(row).getByText("Its condition needs a Cleric, and nothing in the deck provides that.")).toBeInTheDocument();
  expect(within(row).getByText(/Why you might keep it:/).parentElement).toHaveTextContent("its best edge is on your main theme");
  expect(within(row).queryByText(/doesn't fill a core role/)).toBeNull();
});

test("cards nothing argues for and cards with a reason to stay are two groups, the first one first", () => {
  render(<CutList cuts={[cut("Trade-off", { keeps: ["its best edge is on your main theme"] }), cut("Dead weight")]} slack={[]} />);
  const clear = screen.getByRole("region", { name: "Nothing argues for keeping these" });
  const maybe = screen.getByRole("region", { name: "Weak here, but something argues for them" });
  expect(within(clear).getByRole("heading", { name: /Dead weight/ })).toBeInTheDocument();
  expect(within(maybe).getByRole("heading", { name: /Trade-off/ })).toBeInTheDocument();
  expect(clear.compareDocumentPosition(maybe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("trade-offs show four at a time; clear cuts always show in full", async () => {
  const cuts = [
    ...Array.from({ length: 5 }, (_, i) => cut(`Clear ${i + 1}`)),
    ...Array.from({ length: 6 }, (_, i) => cut(`Maybe ${i + 1}`, { keeps: ["rates 1.5 of 5 in this deck"] })),
  ];
  render(<CutList cuts={cuts} slack={[]} />);
  expect(screen.getAllByRole("heading", { name: /^Clear \d/ })).toHaveLength(5);
  expect(screen.getAllByRole("heading", { name: /^Maybe \d/ })).toHaveLength(4);
  await userEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
  expect(screen.getAllByRole("heading", { name: /^Maybe \d/ })).toHaveLength(6);
});

/** THE REST OF THE TRIM (appeal review 2026-09-26): a role over its target shows its cards to pick
 *  from, not only "Consistency 16/13 (+3)". */
test("a role over its target shows its cards and how many can go, instead of a bare count", () => {
  const card = (name: string) => ({ id: name, name, typeLine: "", text: "", isToken: false, isCommander: false, isLand: false, isFace: false, roles: ["draw"], score: 0, manaCost: "", physical: name });
  render(<CutList cuts={[]} trim={[]} slack={[{ category: "Consistency", count: 16, target: 13, over: 3 }]}
    surplus={[{ name: "Consistency", count: 16, target: 13, over: 3, cards: [card("Brainstorm"), card("Ponder")] }]} />);
  expect(screen.getByText(/over its target/).textContent).toMatch(/Consistency is 3 over its target \(16 against 13\), so up to 3 of these can go/);
  expect(within(screen.getByRole("list", { name: "Consistency: 2 cards" })).getAllByRole("listitem")).toHaveLength(2);
  // The bare chip is gone where the cards are shown.
  expect(screen.queryByText("16/13 (+3)")).toBeNull();
});

test("a swap sits right under the cuts it names, before the roles with room", () => {
  const card = { id: "Brainstorm", name: "Brainstorm", typeLine: "", text: "", isToken: false, isCommander: false, isLand: false, isFace: false, roles: ["draw"], score: 0, manaCost: "", physical: "Brainstorm" };
  render(<CutList cuts={[cut("Multiclass Baldric")]} slack={[]} swaps={<p>Multiclass Baldric to Pious Evangel</p>}
    surplus={[{ name: "Consistency", count: 14, target: 13, over: 1, cards: [card] }]} />);
  const swaps = screen.getByRole("region", { name: "A card that could take the slot" });
  expect(within(swaps).getByText("Multiclass Baldric to Pious Evangel")).toBeInTheDocument();
  const clear = screen.getByRole("region", { name: "Nothing argues for keeping these" });
  const room = screen.getByRole("region", { name: "Room in your roles" });
  expect(clear.compareDocumentPosition(swaps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(swaps.compareDocumentPosition(room) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
