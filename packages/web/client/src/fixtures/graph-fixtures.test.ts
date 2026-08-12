import { expect, test } from "vitest";
import inalla from "./inalla-graph.json" with { type: "json" };
import sorin from "./sorin-graph.json" with { type: "json" };
import fairdrazi from "./fairdrazi-graph.json" with { type: "json" };
import changelings from "./changelings-graph.json" with { type: "json" };
import braids from "./braids-graph.json" with { type: "json" };
import type { CardGraph } from "../types.js";

const graph = inalla.graph as CardGraph;

/** Every fixture the harness runs, with the card count captured at the time. Pinned, not just
 *  checked for presence: these are captured through the live api (capture.ts), so a re-capture
 *  against a changed corpus is exactly the event that should fail a test rather than silently
 *  move the numbers every measurement in the board docs is quoted against. */
const FIXTURES = [
  { name: "sorin", fx: sorin, cards: 84 },
  { name: "inalla", fx: inalla, cards: 94 },
  { name: "fairdrazi", fx: fairdrazi, cards: 95 },
  { name: "changelings", fx: changelings, cards: 94 },
  { name: "braids", fx: braids, cards: 75 },
];

test.each(FIXTURES)("the $name fixture still holds $cards card nodes", ({ fx, cards }) => {
  expect((fx.graph as CardGraph).nodes.filter((n) => n.kind === "card").length).toBe(cards);
});

test.each(FIXTURES)("every edge endpoint in the $name fixture resolves to a node", ({ fx }) => {
  const g = fx.graph as CardGraph;
  const ids = new Set(g.nodes.map((n) => n.id));
  expect(g.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to))).toEqual([]);
});

test.each(FIXTURES)("the $name fixture carries the three fields a trial reads", ({ fx }) => {
  // boardTrial reads graph, buildCategories and combos and nothing else; capture.ts writes exactly
  // those. A fixture missing one fails at room-tally time with a much less obvious message.
  expect(fx).toHaveProperty("graph");
  expect(Array.isArray(fx.buildCategories)).toBe(true);
  expect(Array.isArray(fx.combos)).toBe(true);
});

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
