import { expect, test } from "vitest";
import { drawnEdges, litUndrawn } from "./board-edges.js";

test("keeps drawn edges and edges from before the flag existed, drops the undrawn", () => {
  const edges = [
    { from: "a", to: "b", drawn: true },
    { from: "a", to: "c", drawn: false },
    { from: "b", to: "c" },
  ];
  expect(drawnEdges(edges).map((e) => `${e.from}->${e.to}`)).toEqual(["a->b", "b->c"]);
});

// A hover or a selection is computed over every edge; the board paints the drawn set. The gap is
// a lit partner with no line to it (owner, Rani deck, 2026-09-05).
test("litUndrawn returns the undrawn edges a flow or a hover touches, and nothing at rest", () => {
  const l = (a: string, b: string) => ({ source: { id: a }, target: { id: b } });
  const undrawn = [l("rani", "giant"), l("guardian", "rani"), l("kitten", "blur")];
  expect(litUndrawn(undrawn, null, new Set())).toEqual([]);
  expect(litUndrawn(undrawn, "rani", new Set())).toEqual([l("rani", "giant"), l("guardian", "rani")]);
  expect(litUndrawn(undrawn, null, new Set(["guardian>rani"]))).toEqual([l("guardian", "rani")]);
  expect(litUndrawn(undrawn, null, new Map([["kitten>blur", {}]]))).toEqual([l("kitten", "blur")]);
});
