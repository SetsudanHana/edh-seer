import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { GraphView, seedPosition, zoneCentroids } from "./GraphView.js";
import { SAMPLE } from "../fixtures.js";

test("zoneCentroids places each role evenly around the ring at the given radius", () => {
  const c = zoneCentroids(["ramp", "draw", "tutor", "lands"], 100);
  expect(c.size).toBe(4);
  for (const p of c.values()) {
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(100, 5);
  }
  // Opposite ring positions (index 0 and 2 of 4) should be antipodal.
  const ramp = c.get("ramp")!, tutor = c.get("tutor")!;
  expect(ramp.x).toBeCloseTo(-tutor.x, 5);
  expect(ramp.y).toBeCloseTo(-tutor.y, 5);
});

test("zoneCentroids on an empty role list returns an empty map (no divide-by-zero)", () => {
  expect(zoneCentroids([], 100).size).toBe(0);
});

test("seedPosition centres a new node on the previous positions of its known neighbours", () => {
  const prev = new Map([
    ["a", { x: 0, y: 0 }],
    ["b", { x: 10, y: 0 }],
  ]);
  expect(seedPosition(["a", "b"], prev, { x: 999, y: 999 })).toEqual({ x: 5, y: 0 });
});

test("seedPosition falls back when none of the neighbours have a known position", () => {
  const prev = new Map([["a", { x: 0, y: 0 }]]);
  const fallback = { x: 42, y: -7 };
  expect(seedPosition(["unknown-1", "unknown-2"], prev, fallback)).toEqual(fallback);
});

test("seedPosition ignores unknown neighbours and averages only the ones it can find", () => {
  const prev = new Map([["a", { x: 4, y: 8 }]]);
  expect(seedPosition(["a", "ghost"], prev, { x: 0, y: 0 })).toEqual({ x: 4, y: 8 });
});

// Canvas painting (zone chrome, art fills, glyph strokes) isn't exercised here -- jsdom has no
// canvas 2D context, so GraphView's draw effect no-ops (`ctx` is null) the same way it already did
// before this task. This only exercises the plain-React parts: the kind filter row and the glyph
// legend built from the fixture graph's one event node.
test("renders the kind filter row and a legend entry for the graph's event tag", () => {
  render(<GraphView graph={SAMPLE.graph} />);
  expect(screen.getByLabelText(/Deck graph:/)).toBeInTheDocument();
  expect(screen.getByText("card")).toBeInTheDocument();
  expect(screen.getByText("enters")).toBeInTheDocument();
});

test("renders no legend row when the graph has no event nodes", () => {
  const noEvents = { nodes: SAMPLE.graph.nodes.filter((n) => n.kind !== "event"), edges: [] };
  render(<GraphView graph={noEvents} />);
  expect(screen.queryByText("enters")).not.toBeInTheDocument();
});
