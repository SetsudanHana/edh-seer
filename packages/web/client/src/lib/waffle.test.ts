import { expect, test } from "vitest";
import type { DeckReport, GraphNode } from "../types.js";
import { waffleSquares } from "./waffle.js";

const node = (n: Partial<GraphNode>): GraphNode =>
  ({ id: "x", label: "x", copies: 1, types: ["creature"], subtypes: [], supertypes: [], colors: [], cmc: 1, ...n }) as GraphNode;
const card = (c: Partial<DeckReport["cards"][number]>): DeckReport["cards"][number] =>
  ({ name: "x", isCommander: false, score: 0, partnerCount: 0, topPartners: [], ...c }) as DeckReport["cards"][number];

// THE 100-SQUARE CONCEIT IS THE WHOLE POINT: the grid is a picture of the deck's real size, so a
// deck's 24 Mountains are 24 squares and not one node with a badge.
test("expands copies, so the grid is the deck's own size", () => {
  const squares = waffleSquares(
    [node({ id: "Mountain", types: ["land"], copies: 24 }), node({ id: "Sol Ring", types: ["artifact"] })],
    [card({ name: "Mountain" }), card({ name: "Sol Ring" })],
    [],
  );
  expect(squares).toHaveLength(25);
  expect(squares.filter((s) => s.type === null)).toHaveLength(24);
});

// ONE PHYSICAL CARD, ONE SQUARE PER COPY. A multi-face card is one node PER FACE (faces-as-nodes,
// task 7), and counting both faces is the "2 of the 1 unread" defect this repo has now fixed in
// four separate files.
test("a two-faced card is one square, not two", () => {
  const squares = waffleSquares(
    [
      node({ id: "Fell the Profane", cardName: "Fell the Profane // Fell Mire", types: ["sorcery"] }),
      node({ id: "face:1:Fell Mire", cardName: "Fell the Profane // Fell Mire", face: 1, types: ["land"] }),
    ],
    [card({ name: "Fell the Profane", cardName: "Fell the Profane // Fell Mire" })],
    [],
  );
  expect(squares).toHaveLength(1);
  // The FRONT face decides the type, the same basis `typeSlices` counts it under.
  expect(squares[0]!.type).toBe("sorcery");
});

// THREE STATES, AND THEY ARE DIFFERENT FAILURES. Unresolved never reached the corpus; unread
// resolved and carries no derived tags. Only the first is a typo.
test("separates read, unread and unresolved", () => {
  const squares = waffleSquares(
    [node({ id: "Sol Ring", types: ["artifact"] }), node({ id: "Nest of Scarabs", types: ["enchantment"] })],
    [card({ name: "Sol Ring", derived: true }), card({ name: "Nest of Scarabs", derived: false })],
    ["Beholder's Death Ray"],
  );
  expect(squares.map((s) => [s.name, s.state])).toEqual(
    expect.arrayContaining([
      ["Sol Ring", "read"],
      ["Nest of Scarabs", "unread"],
      ["Beholder's Death Ray", "unresolved"],
    ]),
  );
  expect(squares).toHaveLength(3);
});

// GROUPED, BECAUSE AN UNGROUPED GRID IS 100 SQUARES OF NOISE. Commander first -- it is the
// recognition anchor -- then TYPE_ORDER, then lands, then the ones that never resolved.
test("orders commander, then types, then lands, then unresolved", () => {
  const squares = waffleSquares(
    [
      node({ id: "Mountain", types: ["land"] }),
      node({ id: "Lightning Bolt", types: ["instant"] }),
      node({ id: "Krenko, Mob Boss", types: ["creature"] }),
    ],
    [
      card({ name: "Mountain" }),
      card({ name: "Lightning Bolt" }),
      card({ name: "Krenko, Mob Boss", isCommander: true }),
    ],
    ["Typo Card"],
  );
  expect(squares.map((s) => s.name)).toEqual([
    "Krenko, Mob Boss", "Lightning Bolt", "Mountain", "Typo Card",
  ]);
  expect(squares[0]!.isCommander).toBe(true);
});

// A LAND IS NOT A SEVENTH HUE. `primaryType` returns null for a land on purpose -- lands are ~38%
// of the deck and would drown the composition question -- and the waffle keeps that ruling by
// giving them a neutral square rather than adding a colour to TYPE_SEGMENT_HUE.
test("a land carries no composition type", () => {
  const squares = waffleSquares([node({ id: "Bojuka Bog", types: ["land"] })], [card({ name: "Bojuka Bog" })], []);
  expect(squares[0]!.type).toBeNull();
});
