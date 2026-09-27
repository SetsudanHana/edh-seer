import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
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

/** THE REST OF THE TRIM (appeal review 2026-09-26): a role over its target says how many can go.
 *  ONE LINE, POINTING AT THE SHELF (owner, 2026-09-27: one place per fact): the cards to pick from
 *  are on the Roles shelves, which were repeated here as card images. */
test("a role over its target says how many can go and points at its shelf, instead of a bare count", () => {
  const card = (name: string) => ({ id: name, name, typeLine: "", text: "", isToken: false, isCommander: false, isLand: false, isFace: false, roles: ["draw"], score: 0, manaCost: "", physical: name });
  render(<CutList cuts={[]} slack={[{ category: "Consistency", count: 16, target: 13, over: 3 }]}
    surplus={[{ name: "Consistency", count: 16, target: 13, over: 3, cards: [card("Brainstorm"), card("Ponder")] }]} />);
  expect(screen.getByText(/16 against 13: up to 3 can go\./)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Pick them on the shelf" })).toHaveAttribute("href", "#roles");
  expect(screen.queryByRole("list", { name: "Consistency: 2 cards" })).toBeNull();
  // The bare chip is gone where the cards are shown.
  expect(screen.queryByText("16/13 (+3)")).toBeNull();
});

const add = (name: string) => ({ name, slug: name.toLowerCase().replace(/\W+/g, "-"), identity: [], mv: 2, connections: ["A", "B", "C"], reasons: [{ text: `${name} works with A.`, others: [] }] });

/** ONE PLAN (baseline round 2026-09-26: "cuts and adds are not one plan"). The card that could take
 *  a cut's slot sits on that cut's own card, not in a list of its own. */
test("a cut at deck size carries the card that could take its slot", () => {
  render(<MemoryRouter><CutList cuts={[cut("Multiclass Baldric"), cut("Other")]} slack={[]} deckSize={100}
    pairs={[{ cut: "Multiclass Baldric", add: add("Pious Evangel"), rule: "no-role", counts: [], cutConnections: 1 }]} /></MemoryRouter>);
  const row = screen.getByRole("heading", { name: /Multiclass Baldric/ }).closest("li")!;
  expect(within(row).getByTestId("swap")).toHaveTextContent("Swap it for Pious Evangel");
  expect(within(row).getByTestId("swap")).toHaveTextContent("works with 3 of your cards");
  expect(within(row).getByTestId("swap")).toHaveTextContent("Pious Evangel works with A.");
  expect(within(screen.getByRole("heading", { name: /^Other/ }).closest("li")!).queryByTestId("swap")).toBeNull();
  expect(screen.queryByRole("region", { name: "A card that could take the slot" })).toBeNull();
});

/** OVER 100, THE CUTS REACH 100: the first-deck seat, 8 over, got 7 names and "Trim 3 5 10". */
test("over 100, the list leads with exactly as many cuts as the deck is over, weakest first", () => {
  const cuts = [cut("Maybe 1", { keeps: ["rates 1.5 of 5 in this deck"] }), cut("Clear 1"), cut("Clear 2"), cut("Maybe 2", { keeps: ["rates 1.5 of 5 in this deck"] })];
  render(<MemoryRouter><CutList cuts={cuts} slack={[]} deckSize={103}
    pairs={[{ cut: "Clear 1", add: add("Swap In"), rule: "no-role", counts: [], cutConnections: 0 }]} /></MemoryRouter>);
  expect(screen.getByTestId("cuts-over")).toHaveTextContent("Your list has 103 cards, 3 over 100. These 3 are doing the least here, weakest first: take them out and it is 100.");
  expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent?.replace(/2 mana$/, ""))).toEqual(["Clear 1", "Clear 2", "Maybe 1"]);
  expect(screen.getByText(/If you would rather keep one of these,/).parentElement).toHaveTextContent("the next weakest is Maybe 2.");
  // A deck over its size needs cards out, not swaps.
  expect(screen.queryByTestId("swap")).toBeNull();
});

test("over 100 with too few cuts, the list says how many are still to find and where", () => {
  render(<CutList cuts={[cut("Only One")]} slack={[]} deckSize={108} />);
  expect(screen.getByTestId("cuts-over")).toHaveTextContent("These 1 are doing the least here. The other 7 have to come from a role you run more of than you need, below, or from the cards you like least.");
});

test("at deck size, a swap for a role card sits under the cuts; over 100 it does not", () => {
  const pairs = [{ cut: "Despark", add: add("Better Removal"), rule: "same-job" as const, counts: [], cutConnections: 1 }];
  const { unmount } = render(<MemoryRouter><CutList cuts={[cut("Listed")]} slack={[]} deckSize={100} pairs={pairs} /></MemoryRouter>);
  const row = within(screen.getByRole("region", { name: "Better cards for the same job" })).getByTestId("role-swap");
  expect(row).toHaveTextContent("Out: Despark");
  expect(row).toHaveTextContent("Swap it for Better Removal");
  unmount();
  render(<MemoryRouter><CutList cuts={[cut("Listed")]} slack={[]} deckSize={101} pairs={pairs} /></MemoryRouter>);
  expect(screen.queryByRole("region", { name: "Better cards for the same job" })).toBeNull();
});
