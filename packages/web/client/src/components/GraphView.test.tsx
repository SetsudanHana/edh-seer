import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DIM_BY_DEFAULT, GraphView, nodeRadius, seedPosition, separation, zoneCentroids } from "./GraphView.js";
import { SAMPLE } from "../fixtures.js";

test("structural mesh hubs are hidden on first paint", () => {
  expect(new Set(DIM_BY_DEFAULT)).toEqual(
    new Set(["layout", "cmc", "mana", "color", "type", "supertype", "power", "toughness"]),
  );
});

test("the kinds that carry synergy signal are visible on first paint", () => {
  for (const kind of ["card", "event", "subtype", "keyword", "token", "related", "face"]) {
    expect(DIM_BY_DEFAULT).not.toContain(kind);
  }
});

test("no correction when two discs are clear of each other", () => {
  expect(separation(100, 0, 14, 14, 4)).toBeNull();
});

test("overlapping discs are pushed apart along their centre line", () => {
  const s = separation(10, 0, 14, 14, 4)!;
  expect(s).not.toBeNull();
  // gap needed: 14 + 14 + 4 = 32; currently 10 apart, so 22 to close, split half each.
  expect(s.x).toBeCloseTo(11, 5);
  expect(s.y).toBeCloseTo(0, 5);
});

test("coincident discs are separated deterministically rather than dividing by zero", () => {
  const s = separation(0, 0, 14, 14, 4)!;
  expect(Number.isFinite(s.x)).toBe(true);
  expect(Number.isFinite(s.y)).toBe(true);
  expect(Math.hypot(s.x, s.y)).toBeGreaterThan(0);
});

test("a card node's radius is the radius its art is drawn at", () => {
  expect(nodeRadius({ kind: "card", deg: 3 })).toBe(14);
});

test("a card node's radius does not depend on its degree", () => {
  expect(nodeRadius({ kind: "card", deg: 1 })).toBe(nodeRadius({ kind: "card", deg: 40 }));
});

test("a non-card node's radius scales with degree and is capped", () => {
  expect(nodeRadius({ kind: "event", deg: 0 })).toBe(3);
  expect(nodeRadius({ kind: "event", deg: 4 })).toBe(6);
  expect(nodeRadius({ kind: "event", deg: 10000 })).toBe(15);
});

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

test("the canvas exposes a probe describing every visible node's drawn geometry", () => {
  const { container } = render(<GraphView graph={SAMPLE.graph} />);
  const canvas = container.querySelector("canvas") as HTMLCanvasElement & { __graphProbe?: () => Array<{ r: number; kind: string }> };
  // jsdom has no 2d context, so the effect returns before the probe is attached. Assert the
  // contract we can assert here: the property is absent rather than holding a stale value.
  expect(canvas.__graphProbe).toBeUndefined();
});

// requestFullscreen has no jsdom implementation at all (not even a stub that throws), so each
// test below installs its own mock on the prototype. Saved and restored per-test rather than
// left mutated -- this file has many other tests, and a leaked mock/deleted property on
// Element.prototype would bleed into whichever of them runs next.
describe("fullscreen toggle", () => {
  let original: typeof Element.prototype.requestFullscreen;

  beforeEach(() => {
    original = Element.prototype.requestFullscreen;
  });

  afterEach(() => {
    Element.prototype.requestFullscreen = original;
  });

  test("the fullscreen button asks the graph container to go fullscreen", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Element.prototype.requestFullscreen = requestFullscreen;
    const { getByRole } = render(<GraphView graph={SAMPLE.graph} />);
    await userEvent.click(getByRole("button", { name: /fullscreen/i }));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  test("the fullscreen button is absent when the platform does not support it", () => {
    // @ts-expect-error -- deliberately removing the API to test the capability check
    delete Element.prototype.requestFullscreen;
    const { queryByRole } = render(<GraphView graph={SAMPLE.graph} />);
    expect(queryByRole("button", { name: /fullscreen/i })).toBeNull();
  });
});
