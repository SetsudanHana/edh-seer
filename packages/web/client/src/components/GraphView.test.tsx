import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { copiesByNameOf, DIM_BY_DEFAULT, GraphView, nodeRadius, roomAttraction, seedPosition, separation } from "./GraphView.js";
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

// Was "structural mesh hubs are hidden on first paint", asserting the pre-Task-6 default (only
// the eight characteristic kinds dimmed). Task 6 widens DIM_BY_DEFAULT to every non-card kind --
// updated to the new complete set rather than deleted, so a kind silently dropped from the
// default still fails this.
test("every non-card kind is hidden on first paint", () => {
  expect(new Set(DIM_BY_DEFAULT)).toEqual(
    new Set([
      "event", "subtype", "keyword", "token", "related", "face",
      "layout", "cmc", "mana", "color", "type", "supertype", "power", "toughness",
    ]),
  );
});

// The old companion test ("the kinds that carry synergy signal are visible on first paint")
// asserted event/subtype/keyword/token/related/face were NOT dimmed by default -- exactly the
// behaviour Task 6 inverts. Deleted rather than flipped in place: a flipped version would only
// re-assert "card is the sole exception", which the test above (as a full-set equality) and the
// new "hides every non-card kind" test below already cover -- keeping both would be the same
// assertion three times.

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

// Since Task 6, non-card kinds start hidden -- and hidden nodes are filtered out of the probe
// (see `visible`/`__graphProbe` in GraphView.tsx) -- so a bare render's probe now holds only card
// nodes and `.find((n) => n.kind !== "card")` would find nothing. Click the subtype chip on first,
// same as a user would, to bring a non-card node back into the probe.
test("gives a non-card node no rooms", async () => {
  makeContextSpy();
  const { container, getByRole } = render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  await userEvent.click(getByRole("button", { name: /^subtype/ }));
  const canvas = container.querySelector("canvas") as HTMLCanvasElement & {
    __graphProbe?: () => Array<{ kind: string; rooms: string[] | null }>;
  };
  const other = canvas.__graphProbe!().find((n) => n.kind !== "card");
  expect(other?.rooms).toBeNull();
});

test("puts an uncategorised card in strategy", () => {
  makeContextSpy();
  // Neither SAMPLE card carries a `roles` entry, and neither is named in report.combos -- so
  // roomsForCard's only two explicit routes to a room (a role, or membership in a combo) both
  // miss, and a roleless card can only land in strategy via the real fallback (`hit.size === 0`).
  // Zeroing combos here (a local override, not a change to the shared SAMPLE fixture -- this
  // report is scoped to this one test) keeps that true even if SAMPLE's own combos list ever
  // grows to include one of these two cards.
  const report = { ...SAMPLE.report, combos: [] };
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
  // Rooms are circles now (Task 4): an outline is an arc immediately followed by a bare stroke().
  const outlines = calls.filter((c, i) => c === "stroke:" && calls[i - 1]?.startsWith("arc:"));
  expect(outlines.length).toBeGreaterThanOrEqual(ROOMS.length);
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

test("hides every non-card kind on first paint", () => {
  expect(DIM_BY_DEFAULT).toContain("event");
  expect(DIM_BY_DEFAULT).toContain("subtype");
  expect(DIM_BY_DEFAULT).toContain("keyword");
  expect(DIM_BY_DEFAULT).not.toContain("card");
});

test("renders the event chip unpressed so the mesh is one click away", () => {
  render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  expect(screen.getByRole("button", { name: /^event/ })).toHaveAttribute("aria-pressed", "false");
});

// makeContextSpy() is required here (the brief's sketch omitted it): without a real 2D context
// jsdom's guard bails before `__graphProbe` is ever attached, and this would fail on
// `canvas.__graphProbe!()` being undefined rather than on the assertion this test is about.
test("shows only card nodes in the probe by default", () => {
  makeContextSpy();
  const { container } = render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  const canvas = container.querySelector("canvas") as HTMLCanvasElement & {
    __graphProbe?: () => Array<{ kind: string }>;
  };
  expect(canvas.__graphProbe!().every((n) => n.kind === "card")).toBe(true);
});

// Task 7: find a card by name. The fixture (SAMPLE, not the brief's imagined SAMPLE_REPORT) has
// two card nodes -- "Krenko, Mob Boss" and "Impact Tremors" -- with no shared substring, so a
// 3-letter prefix of one is never an accidental hit on the other.
test("renders a search box", () => {
  render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  expect(screen.getByRole("searchbox", { name: /find a card/i })).toBeInTheDocument();
});

test("reports how many cards match what was typed", async () => {
  const user = userEvent.setup();
  render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  const box = screen.getByRole("searchbox", { name: /find a card/i });
  await user.type(box, SAMPLE.graph.nodes.find((n) => n.kind === "card")!.label.slice(0, 3));
  expect(screen.getByTestId("graph-search-count")).toHaveTextContent(/[1-9]/);
});

test("reports no matches for a name that is not in the deck", async () => {
  const user = userEvent.setup();
  render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  await user.type(screen.getByRole("searchbox", { name: /find a card/i }), "zzzzz");
  expect(screen.getByTestId("graph-search-count")).toHaveTextContent(/no match/i);
});

test("matches case-insensitively on a substring", async () => {
  const user = userEvent.setup();
  render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  const name = SAMPLE.graph.nodes.find((n) => n.kind === "card")!.label;
  await user.type(screen.getByRole("searchbox", { name: /find a card/i }), name.toUpperCase());
  expect(screen.getByTestId("graph-search-count")).toHaveTextContent("1");
});

// The context stub (makeContextSpy) records method CALLS, not property assignments, so the ring's
// colour (ctx.strokeStyle) and the dimming (ctx.globalAlpha) are invisible to it -- see the doc
// comment on makeContextSpy. What IS reachable is the ring's own arc: it is the only arc drawn at
// radius ART_RADIUS + 3 (17) anywhere in draw(), so its presence proves the ring was drawn without
// needing to see the stroke colour.
//
// Fix round 1: this used to synchronise with the redraw via a bare `setTimeout(50ms)` real-timer
// sleep, hoping the layout effect's own requestAnimationFrame loop would tick during that window.
// That is a race by construction -- nothing bounds how many (if any) real frames land in 50ms
// under load, and "passed 5/5 on an idle machine" does not rule out flaking in CI. Fixed by
// stubbing requestAnimationFrame to hand back its callback instead of auto-scheduling it, so the
// test drives the exact frame it needs by calling that callback directly: no real time passes, no
// timer race, and the number of redraws is exactly one, not however many happened to fire.
test("draws a ring around a card that matches the search", () => {
  let nextFrame: FrameRequestCallback | null = null;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    nextFrame = cb;
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const calls = makeContextSpy();
  render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  const name = SAMPLE.graph.nodes.find((n) => n.kind === "card")!.label;
  // A synchronous DOM event, not userEvent.type: this test is about the draw pass picking up a
  // changed `matches`, not about simulating realistic keystroke-by-keystroke typing (already
  // covered by the userEvent-based tests above).
  fireEvent.change(screen.getByRole("searchbox", { name: /find a card/i }), { target: { value: name } });
  // The mount-time render already ran one frame with no search active (no radius-17 arc possible
  // yet); invoking the callback requestAnimationFrame handed us drives exactly the next frame,
  // which reads the now-updated matchesRef and must draw the ring.
  nextFrame!(0);
  const ringArcs = calls.filter((c) => c.startsWith("arc:") && c.split(",")[2] === "17");
  expect(ringArcs.length).toBeGreaterThan(0);
});

// Fix round 1: this hover-subcategory case was previously left untested, on the claim that hit
// testing a specific node needed its simulated (Math.random()-jittered) position predicted in
// advance. That claim doesn't hold: __graphProbe already exposes each node's exact settled x/y
// (see the probe tests above), and jsdom's getBoundingClientRect always returns an all-zero rect --
// which, worked through `pick()`'s own math (`(clientX - rect.left - dim.w/2 - cam.x) / cam.z`
// with rect and dim both zero and cam at its identity), means a pointermove's clientX/clientY
// *is* the world coordinate. Dispatching at the probed node's exact (x, y) lands on it with no
// prediction required. Neither SAMPLE card carries `roles`, so this uses a local one-node graph.
test("hover shows a card's build role translated to plain language", () => {
  makeContextSpy();
  const graph = {
    nodes: [{ id: "card:sr", kind: "card", label: "Sol Ring", roles: ["ramp"] }],
    edges: [],
  } as unknown as typeof SAMPLE.graph;
  const report = { ...SAMPLE.report, combos: [], archetypes: [] };
  const { container } = render(<GraphView graph={graph} report={report} />);
  const canvas = container.querySelector("canvas") as HTMLCanvasElement & {
    __graphProbe?: () => Array<{ id: string; x: number; y: number }>;
  };
  const node = canvas.__graphProbe!().find((n) => n.id === "card:sr")!;
  fireEvent(canvas, new MouseEvent("pointermove", { clientX: node.x, clientY: node.y, bubbles: true }));
  // "ramp" is PLAIN's raw category key; subcategoryLabel("ramp") is "extra mana" -- asserting the
  // translated text is what proves the tooltip went through subcategoryLabel rather than just
  // echoing the role verbatim.
  expect(screen.getByText(/extra mana/)).toBeInTheDocument();
});

test("roomAttraction pulls two cards together in proportion to rooms they share", () => {
  const one = roomAttraction(10, 0, 1, 0.01);
  const two = roomAttraction(10, 0, 2, 0.01);
  expect(one.x).toBeLessThan(0); // pulls the first node back toward the second
  expect(Math.abs(two.x)).toBeGreaterThan(Math.abs(one.x));
});

test("roomAttraction is zero for cards sharing no room", () => {
  expect(roomAttraction(10, 0, 0, 0.01)).toEqual({ x: 0, y: 0 });
});

test("roomAttraction does not divide by zero for coincident cards", () => {
  const f = roomAttraction(0, 0, 2, 0.01);
  expect(Number.isFinite(f.x)).toBe(true);
  expect(Number.isFinite(f.y)).toBe(true);
});
