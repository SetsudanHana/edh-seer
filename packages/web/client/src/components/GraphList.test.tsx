import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { GraphList } from "./GraphList.js";
import { CardDrawerProvider } from "./card-drawer.js";
import { SAMPLE } from "../fixtures.js";

const graph = SAMPLE.graph;

const renderList = () =>
  render(
    <CardDrawerProvider graph={graph}>
      <GraphList graph={graph} />
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
  expect(screen.getByText(/the board itself needs a wider screen/)).toBeInTheDocument();
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
