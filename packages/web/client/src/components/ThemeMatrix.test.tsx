import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { ThemeMatrix } from "./ThemeMatrix.js";
import { CardDrawerProvider } from "./card-drawer.js";
import { SAMPLE } from "../fixtures.js";

const groups = [
  { category: "draw", label: "Draw Engine", cards: ["Skullclamp", "Grim Haruspex"], pairs: [] },
  { category: "gy", label: "Graveyard Matters", cards: ["Grim Haruspex"], pairs: [] },
] as never;

const show = (names: string[], g: unknown = groups) =>
  render(
    <CardDrawerProvider graph={SAMPLE.graph}>
      <ThemeMatrix archetypes={g as never} nonlandNames={names} />
    </CardDrawerProvider>,
  );

test("a row carries one dot per group the card is in", () => {
  show(["Skullclamp", "Grim Haruspex"]);
  const rows = screen.getAllByTestId("matrix-row");
  const haruspex = rows.find((r) => r.textContent?.startsWith("Grim Haruspex"))!;
  expect(within(haruspex).getAllByTestId("matrix-dot")).toHaveLength(2);
  const clamp = rows.find((r) => r.textContent?.startsWith("Skullclamp"))!;
  expect(within(clamp).getAllByTestId("matrix-dot")).toHaveLength(1);
});

/** A DOT IS NEVER THE ONLY CARRIER. A grid of coloured dots reads as "blank blank blank" to a
 *  screen reader, which is the colour-only failure this repo keeps fixing -- so every cell states
 *  its own membership either way. */
test("every cell says in words whether it is a member", () => {
  show(["Skullclamp"]);
  expect(screen.getByText("in Draw Engine")).toBeInTheDocument();
  expect(screen.getByText("not in Graveyard Matters")).toBeInTheDocument();
});

/** THE CARDS IN NO GROUP ARE NAMED, not counted: this is the region a cut conversation starts from
 *  and a reader deciding what to cut needs to know which. Measured on the review deck: 25 of 82. */
test("cards in no group are named, with the coverage caveat attached", () => {
  show(["Skullclamp", "Sol Ring", "Arcane Signet"]);
  expect(screen.getByText(/2 cards are in no group at all/)).toBeInTheDocument();
  expect(screen.getByText(/An unread card cannot join a group/)).toBeInTheDocument();
});

// A DECK WHOSE CARDS ALL BELONG SAYS NOTHING, rather than printing a zero.
test("nothing is admitted when every card is in a group", () => {
  show(["Skullclamp", "Grim Haruspex"]);
  expect(screen.queryByText(/in no group at all/)).toBeNull();
});

/** THE FOLD IS A DISCLOSURE AND NEVER A CAP. The matrix's job is the pattern at the top -- the
 *  cards carrying several mechanisms -- and 57 rows of it scrolls past everything under it. */
test("rows past the fold are one click away, and the count says how many", async () => {
  const many = Array.from({ length: 25 }, (_, i) => `Card ${String(i).padStart(2, "0")}`);
  const big = [{ category: "draw", label: "Draw Engine", cards: many, pairs: [] }] as never;
  show(many, big);
  expect(screen.getAllByTestId("matrix-row")).toHaveLength(18);
  await userEvent.click(screen.getByRole("button", { name: /show the other 7 rows/ }));
  expect(screen.getAllByTestId("matrix-row")).toHaveLength(25);
});

// THE ARGUMENT AGAINST A TREEMAP, said with this deck's own arithmetic rather than asserted.
test("it states why it is a grid: more memberships than cards", () => {
  show(["Skullclamp", "Grim Haruspex"]);
  expect(screen.getByText(/3 memberships do not fit in 2 cells/)).toBeInTheDocument();
});

test("no groups means no matrix at all", () => {
  const { container } = show(["Sol Ring"], []);
  expect(container).toBeEmptyDOMElement();
});
