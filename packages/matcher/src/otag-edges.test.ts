import { expect, test } from "vitest";
import type { SlugSemantics } from "@mtg/tagger";
import { buildOtagEdges, pairKey, undirectedPairs } from "./otag-edges.js";

const sem = new Map<string, SlugSemantics>([
  // producer of dies, edge-bearing
  ["sac-outlet", { events: [{ role: "producer", event: "dies" }], effectKind: null, uses: ["edge"] }],
  // consumer of dies, edge-bearing
  ["death-payoff", { events: [{ role: "consumer", event: "dies" }], effectKind: null, uses: ["edge"] }],
  // producer of dies but NOT edge-bearing
  ["dies-classifier", { events: [{ role: "producer", event: "dies" }], effectKind: null, uses: ["classifier"] }],
  // event whose Verb is null -> can never pair
  ["bouncer", { events: [{ role: "producer", event: "return-to-hand" }], effectKind: null, uses: ["classifier"] }],
  // two events on one slug
  ["outlet-multi", {
    events: [{ role: "producer", event: "dies" }, { role: "producer", event: "sacrifice" }],
    effectKind: null, uses: ["edge"],
  }],
  ["sac-payoff", { events: [{ role: "consumer", event: "sacrifice" }], effectKind: null, uses: ["edge"] }],
]);

test("builds an edge when a producer verb meets a consumer verb", () => {
  const edges = buildOtagEdges(
    ["Altar", "Artist"],
    new Map([["Altar", ["sac-outlet"]], ["Artist", ["death-payoff"]]]),
    sem,
  );
  expect(edges).toEqual([{ a: "Altar", b: "Artist", verb: "dies" }]);
});

test("no edge when only one side carries a classified slug", () => {
  const edges = buildOtagEdges(
    ["Altar", "Vanilla"],
    new Map([["Altar", ["sac-outlet"]], ["Vanilla", []]]),
    sem,
  );
  expect(edges).toEqual([]);
});

test("no edge when the slug's uses omits edge", () => {
  const edges = buildOtagEdges(
    ["Altar", "Artist"],
    new Map([["Altar", ["dies-classifier"]], ["Artist", ["death-payoff"]]]),
    sem,
  );
  expect(edges).toEqual([]);
});

test("no edge when the event maps to a null Verb", () => {
  const edges = buildOtagEdges(
    ["Boomerang", "Artist"],
    new Map([["Boomerang", ["bouncer"]], ["Artist", ["death-payoff"]]]),
    sem,
  );
  expect(edges).toEqual([]);
});

test("a multi-event slug contributes each event independently", () => {
  const edges = buildOtagEdges(
    ["Altar", "Artist", "SacPay"],
    new Map([
      ["Altar", ["outlet-multi"]],
      ["Artist", ["death-payoff"]],
      ["SacPay", ["sac-payoff"]],
    ]),
    sem,
  );
  expect(edges).toContainEqual({ a: "Altar", b: "Artist", verb: "dies" });
  expect(edges).toContainEqual({ a: "Altar", b: "SacPay", verb: "sacrifice" });
  expect(edges).toHaveLength(2);
});

test("a card never edges with itself", () => {
  const edges = buildOtagEdges(
    ["Both"],
    new Map([["Both", ["sac-outlet", "death-payoff"]]]),
    sem,
  );
  expect(edges).toEqual([]);
});

test("undirectedPairs collapses both directions into one key", () => {
  const pairs = undirectedPairs([
    { a: "Altar", b: "Artist", verb: "dies" },
    { a: "Artist", b: "Altar", verb: "sacrifice" },
  ]);
  expect(pairs).toEqual(new Set([pairKey("Altar", "Artist")]));
});
