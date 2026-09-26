import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { CardGraph, DeckReport } from "../types.js";
import { RoleShelves, roleShelves } from "./RoleShelves.js";

function deck() {
  const report = {
    commanders: ["Rani"],
    cards: [
      { name: "Rani", isCommander: true, manaValue: 3, roles: [] },
      { name: "Chaos Warp", isCommander: false, manaValue: 3, roles: ["targetedRemoval"] },
      { name: "Swords to Plowshares", isCommander: false, manaValue: 1, roles: ["targetedRemoval"] },
      { name: "Beast Within", isCommander: false, manaValue: 3, roles: ["targetedRemoval"] },
      // One card, two rows: the land back carries the card's roles too.
      { name: "Fell the Profane", cardName: "Fell the Profane // Fell Mire", isCommander: false, manaValue: 6, roles: ["lands", "targetedRemoval"] },
      { name: "Fell Mire", cardName: "Fell the Profane // Fell Mire", face: 1, isCommander: false, manaValue: 6, roles: ["lands", "targetedRemoval"] },
      { name: "Arcane Signet", isCommander: false, manaValue: 2, roles: ["ramp"] },
      { name: "Forest", isCommander: false, manaValue: 0, roles: ["lands"] },
      { name: "Kodama's Reach", isCommander: false, manaValue: 3, roles: ["ramp", "draw"] },
    ],
    buildParents: [
      { name: "Consistency", count: 1, target: 10, leaves: ["draw", "tutor"] },
      { name: "Ramp", count: 2, target: 10, leaves: ["ramp"] },
      { name: "Interaction", count: 4, target: 10, leaves: ["targetedRemoval", "stackInteraction"] },
    ],
    buildCategories: [{ category: "lands", count: 36, target: 36 }],
  } as unknown as DeckReport;
  const graph = { nodes: [{ id: "Chaos Warp", label: "Chaos Warp", types: ["instant"], cmc: 3, artCrop: "https://cards.scryfall.io/art_crop/x.jpg" }], edges: [] } as unknown as CardGraph;
  return { report, graph };
}

test("a two-faced card sits on its shelf once, by its front, so the shelf matches the chapter's count", () => {
  const { report, graph } = deck();
  const removal = roleShelves(report, graph).find((s) => s.category === "targetedRemoval")!;
  expect(removal.cards.map((c) => c.name)).toEqual(["Swords to Plowshares", "Beast Within", "Chaos Warp", "Fell the Profane"]);
});

test("shelves follow the chapter's role order, leave out lands and empty roles, and order by mana value then name", () => {
  const { report, graph } = deck();
  const shelves = roleShelves(report, graph);
  expect(shelves.map((s) => s.category)).toEqual(["draw", "ramp", "targetedRemoval"]);
  expect(shelves.find((s) => s.category === "ramp")!.cards.map((c) => c.name)).toEqual(["Arcane Signet", "Kodama's Reach"]);
});

test("each shelf is a list of cards with their names, labelled in a player's words", () => {
  const { report, graph } = deck();
  render(<RoleShelves report={report} graph={graph} />);
  const removal = screen.getByRole("list", { name: "Removal: 4 cards" });
  expect(within(removal).getAllByRole("listitem")).toHaveLength(4);
  expect(within(removal).getByAltText("Chaos Warp")).toBeInTheDocument();
  expect(within(removal).getByText("Chaos Warp")).toBeInTheDocument();
  expect(within(removal).getByText("Fell the Profane")).toBeInTheDocument();
  expect(within(removal).queryByText("Fell Mire")).toBeNull();
  expect(screen.getByRole("list", { name: "Draw: 1 card" })).toBeInTheDocument();
});
