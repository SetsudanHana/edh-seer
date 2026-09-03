import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { GraphList } from "./GraphList.js";
import { CardDrawerProvider } from "./card-drawer.js";
import { SAMPLE } from "../fixtures.js";

const graph = SAMPLE.graph;

const renderList = (props: { onOpenBoard?: (id: string) => void } = {}) =>
  render(
    <CardDrawerProvider graph={graph}>
      <GraphList graph={graph} {...props} />
    </CardDrawerProvider>,
  );

// AT 390px THE LAYOUT IS WHAT FAILS, not the data: a ~324x378 canvas cannot carry readable position
// for 95 discs, while who-feeds-whom delivers fine as a list. Ranked by partners, because a list has
// no geometry to say "this is the middle of the deck".
test("GraphList ranks cards by how many partners they have, name breaking the tie", () => {
  renderList();
  const rows = screen.getAllByRole("listitem");
  expect(rows.map((r) => r.textContent?.split("1 partner")[0])).toEqual([
    "Impact Tremors", "Krenko, Mob Boss",
  ]);
  expect(rows[0]!.textContent).toContain("1 partner");
  // The strongest edge's sentence rides on the row, so a list row still says WHY.
  expect(rows[0]!.textContent).toContain("pays off tokens");
});

test("GraphList states the shape of the graph it is standing in for", () => {
  renderList();
  expect(screen.getByText(/2 cards, 1 synergies/)).toBeInTheDocument();
  // R1: the old clause said "the board itself needs a wider screen". It is false now -- the board
  // is one tap from a row -- and it was the silent-substitution complaint in the first place.
  expect(screen.queryByText(/needs a wider screen/)).toBeNull();
});

// THE LIST IS THE SEARCH STEP, AND IT HAS TO SAY THE BOARD EXISTS (roadmap R1). Without a way
// through, this surface was a substitution nothing announced: the phone judge tapped GRAPH, got a
// screen of chips and a list, and never learned a picture of their deck was reachable at all.
test("GraphList offers the board on rows that have one, and nowhere else", async () => {
  const user = userEvent.setup();
  const opened: string[] = [];
  renderList({ onOpenBoard: (id: string) => opened.push(id) });
  const buttons = screen.getAllByRole("button", { name: /see what it connects to/i });
  // Both fixture cards have a partner; a card with none would have a one-disc graph, which the
  // sheet says in words instead.
  expect(buttons).toHaveLength(2);
  await user.click(buttons[0]!);
  expect(opened).toHaveLength(1);
});

test("GraphList offers no board when there is none to offer", () => {
  renderList();
  expect(screen.queryByRole("button", { name: /see what it connects to/i })).toBeNull();
});

test("GraphList filters by name", async () => {
  const user = userEvent.setup();
  renderList();
  await user.type(screen.getByRole("searchbox", { name: "Find a card" }), "impact");
  const rows = screen.getAllByRole("listitem");
  expect(rows).toHaveLength(1);
  expect(rows[0]!.textContent).toContain("Impact Tremors");
});

// The row IS the drill-down: tapping a card opens the same inspector the board opens, through the
// drawer the rest of the report already uses.
test("GraphList opens the card inspector on tap", async () => {
  const user = userEvent.setup();
  renderList();
  await user.click(screen.getByRole("button", { name: "Krenko, Mob Boss" }));
  const panel = screen.getByTestId("card-inspector");
  expect(within(panel).getByRole("heading", { level: 3 })).toHaveTextContent("Krenko, Mob Boss");
  expect(within(panel).getByText(/pays off tokens/)).toBeInTheDocument();
});

// AN UNREAD CARD AND A READ LONER BOTH SAT AT "0 partners" AND LOOKED IDENTICAL. They are
// different sentences and only one of them is about the deck: "nothing connects to it" is a
// finding, "we could not read it" is the engine's own gap. The row says which, and carries the
// hatch so the mark is learnable here and recognisable on the board.
test("GraphList says an unread card was not read, instead of counting its partners", () => {
  render(
    <CardDrawerProvider graph={graph}>
      <GraphList graph={graph} unread={new Set(["Impact Tremors"])} />
    </CardDrawerProvider>,
  );
  const rows = screen.getAllByRole("listitem");
  // Matched on the row's OPENING text: every reason sentence in this fixture names both cards,
  // so `includes` would pick whichever row it reached first.
  const unreadRow = rows.find((r) => r.textContent?.startsWith("Impact Tremors"))!;
  expect(unreadRow.textContent).toContain("not read");
  expect(unreadRow.textContent).not.toContain("partner");
  expect(within(unreadRow).getByTestId("unread-hatch")).toBeInTheDocument();
  const readRow = rows.find((r) => r.textContent?.startsWith("Krenko"))!;
  expect(readRow.textContent).toContain("partner");
  expect(within(readRow).queryByTestId("unread-hatch")).toBeNull();
});

// A FULLY READ DECK MARKS NOTHING. A mark that is always present marks nothing -- the same rule
// `DerivedMark` and `CoveragePanel` are both built on.
test("GraphList marks nothing when the engine read the whole deck", () => {
  renderList();
  expect(screen.queryByTestId("unread-hatch")).toBeNull();
});

// AND IT COUNTS THEM, because a mark on a row cannot be surveyed: counting "not read" down 92 rows
// by scrolling is not counting. The board states the same total in a chip; this list has no chip
// row to put it in.
test("GraphList states how many cards were not read", () => {
  render(
    <CardDrawerProvider graph={graph}>
      <GraphList graph={graph} unread={new Set(["Impact Tremors"])} />
    </CardDrawerProvider>,
  );
  expect(screen.getByText(/2 cards, 1 synergies, 1 not read\./)).toBeInTheDocument();
});
