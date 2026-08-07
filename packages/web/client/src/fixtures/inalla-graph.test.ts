import { expect, test } from "vitest";
import inalla from "./inalla-graph.json" with { type: "json" };
import type { CardGraph } from "../types.js";

const graph = inalla.graph as CardGraph;

test("the inalla fixture carries a real deck's worth of card nodes", () => {
  const cards = graph.nodes.filter((n) => n.kind === "card");
  expect(cards.length).toBe(94);
});

test("the inalla fixture carries the build categories the room tallies need", () => {
  const categories = inalla.buildCategories.map((c) => c.category);
  // roomTallies sums a room's target from its categories; lands is the one with a large
  // target, which is what makes the Lands room's radius differ from a bare count. Pinned to
  // the captured value, not just checked for presence: a re-capture that silently zeroed it
  // would otherwise pass this guard, which is the rot this test exists to catch.
  expect(categories).toContain("lands");
  expect(inalla.buildCategories.find((c) => c.category === "lands")?.target).toBe(36);
  expect(inalla.buildCategories.every((c) => typeof c.target === "number")).toBe(true);
});

test("every edge endpoint resolves to a node", () => {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const dangling = graph.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to));
  expect(dangling).toEqual([]);
});
