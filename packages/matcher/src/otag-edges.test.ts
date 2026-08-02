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
  // event whose Verb is null -> can never pair, even when the slug claims "edge".
  // loadOtagSemantics() would REJECT this exact shape at load time (it throws when a slug
  // claims "edge" but no event maps to a non-null Verb -- see semantics.ts). This fixture
  // bypasses the loader deliberately, since buildOtagEdges takes a Map directly and never
  // calls it. So this proves buildOtagEdges' own null-Verb guard holds as defense-in-depth,
  // independent of (and even if we lost) that upstream loader invariant.
  ["bouncer", { events: [{ role: "producer", event: "return-to-hand" }], effectKind: null, uses: ["edge"] }],
  // consumer of a DIFFERENT null-mapped event ("copy"), same deliberate loader-invalid shape as
  // bouncer above. Exists so the null-guard test below has something to actually collide with:
  // pairing bouncer's producer side against ONLY death-payoff (a real "dies" consumer) can never
  // falsify the guard, because null !== "dies" whether or not the guard runs. Two DIFFERENT
  // null-mapped events (return-to-hand, copy) both degenerate to the same JS `null` if the guard
  // is removed, so a producer of one and a consumer of the other would wrongly pair -- that
  // collision is exactly what the guard exists to prevent, and what makes the test meaningful.
  ["copy-watcher", { events: [{ role: "consumer", event: "copy" }], effectKind: null, uses: ["edge"] }],
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
  // Both sides map to null via DIFFERENT otag events (return-to-hand, copy). Without the
  // `if (!verb) continue` guard in verbsFor, both degenerate to the same JS `null` and would
  // wrongly pair as a "null" edge. With the guard, both sides are skipped and produces/consumes
  // stay empty, so no edge forms.
  const edges = buildOtagEdges(
    ["Boomerang", "CopyCat"],
    new Map([["Boomerang", ["bouncer"]], ["CopyCat", ["copy-watcher"]]]),
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
