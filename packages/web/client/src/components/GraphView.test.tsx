import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { copiesByNameOf, DIM_BY_DEFAULT, GraphView, nodeRadius, seedPosition, separation } from "./GraphView.js";
import { SAMPLE } from "../fixtures.js";
import type { GraphNode } from "../types.js";
import { ROOMS, type RoomTally } from "./deck-rooms.js";

/** Records the 2D-context calls made during a render, and -- more importantly -- lets the
 *  layout effect get past its `if (!ctx) return;` guard at all, which is what attaches
 *  `__graphProbe`. jsdom has no canvas, so without this stub every probe-reading test below
 *  fails for the wrong reason (the probe never existing) rather than the reason it's testing.
 *
 *  jsdom also has no `Path2D` global at all (see graph-glyphs.ts's doc comment) -- unreachable
 *  before this task because `draw()`'s glyph branch only ran once `ctx` was real, which it never
 *  was under jsdom. Making `ctx` real here makes that branch reachable too, so it needs its own
 *  stub: a no-op constructor is enough since `ctx.stroke(path)` itself is already swallowed by
 *  the proxy below, which doesn't care what the argument is.
 *
 *  Both stubs are restored per-test by the top-level afterEach so neither leaks into a test that
 *  asserts the no-context baseline (see the "probe is absent" test further down). */
function makeContextSpy(calls: string[] = []) {
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop: string) {
      if (prop === "measureText") return () => ({ width: 40 });
      return (...args: unknown[]) => { calls.push(`${prop}:${args.join(",")}`); };
    },
    set() { return true; },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
  vi.stubGlobal("Path2D", class { constructor(_d?: string) {} });
  return calls;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

test("copiesByNameOf keys a card's copy count by name, defaulting an absent count to one", () => {
  const nodes = [
    { id: "card:a", kind: "card", label: "Relentless Rats", copies: 9 },
    { id: "card:b", kind: "card", label: "Sol Ring" },
    { id: "subtype:goblin", kind: "subtype", label: "goblin" },
  ] as GraphNode[];
  const m = copiesByNameOf(nodes);
  expect(m.get("Relentless Rats")).toBe(9);
  expect(m.get("Sol Ring")).toBe(1);
  expect(m.has("goblin")).toBe(false);
});

// Fix round 1: the previous version of this test called roomTallies/copiesByNameOf directly with
// inline arguments, so it never went through GraphView's own `tallies` useMemo -- dropping the
// third argument at the REAL call site (GraphView.tsx) would not have failed it. Routing through
// a render + the probe (which now carries `tallies` -- see below) closes that gap: this fails if
// GraphView's tallies memo ever regresses to `roomTallies(cardRooms, report.buildCategories)`
// with copiesByNameOf's result dropped.
test("a multi-copy card counts by its copies in the room tallies reachable from a real render, not once", () => {
  makeContextSpy();
  const graph = { nodes: [{ id: "card:mtn", kind: "card", label: "Mountain", roles: ["lands"], copies: 24 }], edges: [] } as unknown as typeof SAMPLE.graph;
  const report = { ...SAMPLE.report, buildCategories: [{ category: "lands", count: 24, target: 36 }], combos: [], archetypes: [] };
  const { container } = render(<GraphView graph={graph} report={report} />);
  const canvas = container.querySelector("canvas") as HTMLCanvasElement & {
    __graphProbe?: () => { tallies: Map<string, RoomTally> };
  };
  expect(canvas.__graphProbe!().tallies.get("lands")!.count).toBe(24);
});

// Canvas painting (zone chrome, art fills, glyph strokes) isn't exercised here -- jsdom has no
// canvas 2D context, so GraphView's draw effect no-ops (`ctx` is null) the same way it already did
// before this task. This only exercises the plain-React parts: the kind filter row and the glyph
// legend built from the fixture graph's one event node.
test("renders the kind filter row and a legend entry for the graph's event tag", () => {
  render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  expect(screen.getByLabelText(/Deck graph:/)).toBeInTheDocument();
  expect(screen.getByText("card")).toBeInTheDocument();
  expect(screen.getByText("enters")).toBeInTheDocument();
});

test("renders no legend row when the graph has no event nodes", () => {
  const noEvents = { nodes: SAMPLE.graph.nodes.filter((n) => n.kind !== "event"), edges: [] };
  render(<GraphView graph={noEvents} report={SAMPLE.report} />);
  expect(screen.queryByText("enters")).not.toBeInTheDocument();
});

// No context spy here, deliberately: this documents the no-canvas baseline (very old browser, or
// -- in this suite -- every OTHER test in this file) still no-ops safely rather than throwing.
test("the canvas exposes a probe describing every visible node's drawn geometry", () => {
  const { container } = render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  const canvas = container.querySelector("canvas") as HTMLCanvasElement & { __graphProbe?: () => Array<{ r: number; kind: string }> };
  // jsdom has no 2d context, so the effect returns before the probe is attached. Assert the
  // contract we can assert here: the property is absent rather than holding a stale value.
  expect(canvas.__graphProbe).toBeUndefined();
});

test("exposes each card's rooms on the measurement probe", () => {
  makeContextSpy();
  const { container } = render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  const canvas = container.querySelector("canvas") as HTMLCanvasElement & {
    __graphProbe?: () => Array<{ id: string; kind: string; rooms: string[] | null }>;
  };
  const nodes = canvas.__graphProbe!();
  const card = nodes.find((n) => n.kind === "card")!;
  expect(Array.isArray(card.rooms)).toBe(true);
  expect(card.rooms!.length).toBeGreaterThan(0);
});

test("gives a non-card node no rooms", () => {
  makeContextSpy();
  const { container } = render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  const canvas = container.querySelector("canvas") as HTMLCanvasElement & {
    __graphProbe?: () => Array<{ kind: string; rooms: string[] | null }>;
  };
  const other = canvas.__graphProbe!().find((n) => n.kind !== "card");
  expect(other?.rooms).toBeNull();
});

test("puts an uncategorised card in strategy", () => {
  makeContextSpy();
  // Fix round 1: neither SAMPLE card carries a `roles` entry, but BOTH are named in
  // report.archetypes[0].cards -- so without this override they reach strategy through the
  // explicit `strategyCards.has(name)` branch in roomsForCard, never through the true fallback
  // (`hit.size === 0`) this test claims to cover. Zeroing out combos/archetypes here (a local
  // override, not a change to the shared SAMPLE fixture -- this report is scoped to this one
  // test) removes both explicit branches, so a roleless card can only land in strategy via the
  // real fallback.
  const report = { ...SAMPLE.report, combos: [], archetypes: [] };
  const { container } = render(<GraphView graph={SAMPLE.graph} report={report} />);
  const canvas = container.querySelector("canvas") as HTMLCanvasElement & {
    __graphProbe?: () => Array<{ id: string; kind: string; roles: string[] | null; rooms: string[] | null }>;
  };
  const roleless = canvas.__graphProbe!().find((n) => n.kind === "card" && !n.roles?.length);
  expect(roleless).toBeDefined();
  expect(roleless!.rooms).toEqual(["strategy"]);
});

// requestFullscreen has no jsdom implementation at all (not even a stub that throws), so each
// test below installs its own mock on the prototype. Saved and restored per-test rather than
// left mutated -- this file has many other tests, and a leaked mock/deleted property on
// Element.prototype would bleed into whichever of them runs next.
test("labels every room, including ones holding no cards", () => {
  const calls = makeContextSpy();
  render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  const drawn = calls.filter((c) => c.startsWith("fillText:")).join(" ");
  expect(drawn).toContain("BOARD WIPES 0/3");
  for (const room of ROOMS) {
    expect(drawn).toContain(room.label.toUpperCase());
  }
});

test("draws a room outline for all seven rooms", () => {
  const calls = makeContextSpy();
  render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  expect(calls.filter((c) => c.startsWith("strokeRect:")).length).toBeGreaterThanOrEqual(ROOMS.length);
});

describe("fullscreen toggle", () => {
  let original: typeof Element.prototype.requestFullscreen;

  beforeEach(() => {
    original = Element.prototype.requestFullscreen;
  });

  afterEach(() => {
    // jsdom has no requestFullscreen at all, so the real baseline is "no such property" --
    // `original` reads as `undefined` in that case. Assigning `undefined` back would not restore
    // that baseline: it creates an OWN property on the prototype holding `undefined`, and
    // `"requestFullscreen" in Element.prototype` (the exact capability check the feature uses)
    // is true for an own property regardless of its value. Delete when there was nothing to
    // restore; only reassign when a real value was captured.
    if (original === undefined) {
      // @ts-expect-error -- restoring jsdom's default (no such property), not merely undefined
      delete Element.prototype.requestFullscreen;
    } else {
      Element.prototype.requestFullscreen = original;
    }
    delete (document as { fullscreenElement?: unknown }).fullscreenElement;
  });

  test("the fullscreen button asks the graph container to go fullscreen", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Element.prototype.requestFullscreen = requestFullscreen;
    const { getByRole, getByTestId } = render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
    await userEvent.click(getByRole("button", { name: /fullscreen/i }));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    // requestFullscreen is mocked on Element.prototype, so toHaveBeenCalledTimes(1) alone passes
    // regardless of which element it was called on -- this is the exact defect ff53076 fixed
    // (ref moved to the inner canvas container instead of the shell that also wraps the exit
    // button). Assert the receiver too so that regression can't come back silently.
    expect(requestFullscreen.mock.instances[0]).toBe(getByTestId("graph-fullscreen-shell"));
  });

  test("the fullscreen button is absent when the platform does not support it", () => {
    // @ts-expect-error -- deliberately removing the API to test the capability check
    delete Element.prototype.requestFullscreen;
    const { queryByRole } = render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
    expect(queryByRole("button", { name: /fullscreen/i })).toBeNull();
  });

  test("the button label and aria-pressed follow fullscreenchange events in both directions", () => {
    Element.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const { getByRole, getByTestId } = render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
    const shell = getByTestId("graph-fullscreen-shell");

    // Entering: the browser (not this component) sets document.fullscreenElement and fires the
    // event; simulate that rather than clicking, since click only calls requestFullscreen -- it
    // is the browser granting the request that actually flips fullscreen state. fireEvent (not a
    // raw dispatchEvent) wraps this in `act` so the resulting setState is flushed before assert.
    Object.defineProperty(document, "fullscreenElement", { value: shell, configurable: true });
    fireEvent(document, new Event("fullscreenchange"));
    const exitButton = getByRole("button", { name: /exit fullscreen/i });
    expect(exitButton).toHaveAttribute("aria-pressed", "true");

    // Exiting (Escape, or the button's own click handler calling exitFullscreen): the browser
    // clears fullscreenElement and fires the same event again.
    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    fireEvent(document, new Event("fullscreenchange"));
    const enterButton = getByRole("button", { name: /^fullscreen$/i });
    expect(enterButton).toHaveAttribute("aria-pressed", "false");
  });
});
