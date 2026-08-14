import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ART_RADIUS, GraphView, edgeWidth, nodeRadius, seedPosition, traveledAsPan } from "./GraphView.js";
import { SAMPLE } from "../fixtures.js";
import type { CardGraph, GraphNode } from "../types.js";
import { zoomIdentity, type ZoomTransform } from "d3-zoom";
import { CARD_MODE_Z } from "./card-node.js";
import { IDENTITY_HUE, PAINT_MODES, ROLE_HUE, TYPE_HUE } from "./presets.js";
import { createBoardSimulation, DEFAULT_PARAMS, LINK_DIST_MIN } from "./board-force.js";
import sorinFixture from "../fixtures/sorin-graph.json" with { type: "json" };

// Spies the real createBoardSimulation (importOriginal, not a stub) so every existing test still
// gets a real simulation -- only the "drives the simulation's constants" test below reads the
// spy. Needed to catch two mutations neither `expect(slider.value)...` nor an `__graphProbe`
// identity check would catch on their own: `params` silently dropped from the constructor call,
// or BoardTuner holding `params` in its own state and never calling `onChange`.
vi.mock("./board-force.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./board-force.js")>();
  return { ...mod, createBoardSimulation: vi.fn(mod.createBoardSimulation) };
});

/** Records the 2D-context calls made during a render, and -- more importantly -- lets the layout
 *  effect get past its `if (!ctx) return;` guard at all, which is what attaches `__graphProbe`.
 *  jsdom has no canvas, so without this stub every probe-reading test below fails for the wrong
 *  reason (the probe never existing) rather than the reason it's testing.
 *
 *  Restored per-test by the top-level afterEach so it never leaks into the test that asserts the
 *  no-context baseline. */
function makeContextSpy(calls: string[] = []) {
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop: string) {
      if (prop === "measureText") return () => ({ width: 40 });
      return (...args: unknown[]) => { calls.push(`${prop}:${args.join(",")}`); };
    },
    set(_t, prop: string, value: unknown) {
      calls.push(`set:${prop}=${String(value)}`);
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
  return calls;
}

/** Overrides the harmless default ResizeObserver stub (test-setup.ts) with one that captures the
 *  callback the component registers and the element it observed, so a test can fire it directly.
 *  Must be called BEFORE the render that constructs the observer.
 *
 *  What this proves and what it cannot: jsdom has no ResizeObserver at all, so nothing here can
 *  show that entering fullscreen ever calls this callback in a real browser -- that fact came from
 *  a live measurement (task-11 fix round 2 brief), not from this stub, and this stub cannot
 *  reproduce it. What this DOES prove: that once the callback fires, by whatever means, the
 *  component reframes correctly and does not depend on a window "resize" event ALSO firing --
 *  `fire()` below never dispatches one. */
function stubResizeObserver() {
  let callback: ResizeObserverCallback | null = null;
  const observe = vi.fn();
  const disconnect = vi.fn();
  // A plain `function`, not an arrow: `new ResizeObserver(...)` in the component invokes this
  // constructor-style, and an arrow function throws "is not a constructor" the instant `new`
  // touches it.
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn().mockImplementation(function (cb: ResizeObserverCallback) {
      callback = cb;
      return { observe, unobserve: vi.fn(), disconnect };
    }),
  );
  return {
    fire: () => callback!([] as unknown as ResizeObserverEntry[], {} as ResizeObserver),
    observe,
    disconnect,
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** A card as the wire sends it: facets are FIELDS, and `id` is the card's own name. */
function card(over: Partial<GraphNode> & { id: string }): GraphNode {
  return {
    label: over.id, copies: 1, types: ["creature"], subtypes: [], supertypes: [], colors: ["R"],
    cmc: 2, ...over,
  };
}
function graphOf(nodes: GraphNode[], edges: CardGraph["edges"] = []): CardGraph {
  return { nodes, edges, undirectedReasons: 0, offDeckReasons: 0 };
}

/** Renders and hands back the callback requestAnimationFrame was given, so a test drives the exact
 *  frame it needs instead of racing real timers. */
function frames(graph: CardGraph, calls?: string[]) {
  let nextFrame: FrameRequestCallback | null = null;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { nextFrame = cb; return 0; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  makeContextSpy(calls);
  const { container } = render(<GraphView graph={graph} report={SAMPLE.report} />);
  const canvas = container.querySelector("canvas") as HTMLCanvasElement & {
    __graphProbe?: () => Array<{ id: string; x: number; y: number; r: number; deg: number }> & {
      camZ: number;
      edges: Array<{ from: string; to: string; weight: number; target: number }>;
      toWorld: (ev: { clientX: number; clientY: number }) => { x: number; y: number };
      endGesture: (
        ev: { type: string; clientX?: number; clientY?: number; changedTouches?: Array<{ clientX: number; clientY: number }> },
        transform?: ZoomTransform,
      ) => void;
    };
  };
  return { container, canvas, tick: (n = 1) => { for (let i = 0; i < n; i++) nextFrame!(0); } };
}

test("seedPosition centres a new node on the previous positions of its known neighbours", () => {
  const prev = new Map([["a", { x: 0, y: 0 }], ["b", { x: 10, y: 0 }]]);
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

// The click-vs-pan decision. Kept for Task 8's inspector, which hangs off the same "end" handler:
// jsdom cannot construct a real mousedown-driven zoom gesture (any MouseEvent carrying a `view`,
// which d3-zoom's mousedown handler requires, fails jsdom's UIEvent brand check here -- even for
// `window` itself), so the arithmetic is what is unit-testable, not the gesture producing it.
// These five cases are the browser matrix measured against a real click-swallowing gesture
// (k 6.33, wobble 0/1/2/3/6 px): a real click only registered at 0 px, but CLICK_DRAG_PX is 4, so
// 1/2/3 px must all still count as a click and only 6 px as a pan.
test("traveledAsPan matches the browser's wobble-vs-click matrix (0/1/2/3 px are clicks, 6 px is not)", () => {
  const start = { x: 0, y: 0, k: 6.33 };
  expect(traveledAsPan(start, { x: 0, y: 0, k: 6.33 })).toBe(false); // 0 px
  expect(traveledAsPan(start, { x: 1, y: 0, k: 6.33 })).toBe(false); // 1 px
  expect(traveledAsPan(start, { x: 2, y: 0, k: 6.33 })).toBe(false); // 2 px
  expect(traveledAsPan(start, { x: 3, y: 0, k: 6.33 })).toBe(false); // 3 px
  expect(traveledAsPan(start, { x: 6, y: 0, k: 6.33 })).toBe(true); // 6 px, past CLICK_DRAG_PX (4)
});

test("traveledAsPan's threshold is exclusive, not inclusive, at the boundary", () => {
  const start = { x: 0, y: 0, k: 1 };
  expect(traveledAsPan(start, { x: 4, y: 0, k: 1 })).toBe(false); // exactly at CLICK_DRAG_PX (4)
  expect(traveledAsPan(start, { x: 4.001, y: 0, k: 1 })).toBe(true); // one hair past it
});

test("traveledAsPan measures straight-line distance, not axis-aligned drift", () => {
  // 3-4-5 triangle: neither axis alone crosses the default threshold (4), but the combined
  // distance (5) does -- proving this hypots both axes rather than checking them independently.
  expect(traveledAsPan({ x: 0, y: 0, k: 1 }, { x: 3, y: 4, k: 1 })).toBe(true);
});

test("traveledAsPan's threshold is a parameter, not a hidden constant", () => {
  expect(traveledAsPan({ x: 0, y: 0, k: 1 }, { x: 2, y: 0, k: 1 }, 1)).toBe(true);
  expect(traveledAsPan({ x: 0, y: 0, k: 1 }, { x: 2, y: 0, k: 1 }, 5)).toBe(false);
});

// A click can't change the camera's scale, so a "click" reporting a different k than the gesture
// started with did not just click -- it zoomed. Real gestures never hit this (wheel and mouse-drag
// are mutually exclusive within one gesture), but the function is total.
test("traveledAsPan treats a scale change as a pan even with zero translation", () => {
  expect(traveledAsPan({ x: 0, y: 0, k: 1 }, { x: 0, y: 0, k: 1.5 })).toBe(true);
});

/** The gesture wiring itself, driven through the probe's `endGesture` hook -- the same
 *  `zoomBehavior.transform` call `jumpZoom` makes in production, with a literal event object as a
 *  4th argument, which is what sidesteps the jsdom limitation above rather than faking around it.
 *
 *  This one asserts the WIRING alone: that the hook and the handler behind it still exist and
 *  still admit exactly the four gesture shapes fix rounds 2 and 3 established -- a mouseup, a
 *  touchend, a touchcancel (never admitted), and a touchend with no changed touches (must fall
 *  through, not throw). Task 8 gave the handler a body and turned each shape into an assertion
 *  about the inspector; those live in the `the inspector` describe block below. This test stays
 *  because the shapes are what three fix rounds bought, and an inspector assertion would go red
 *  for either reason -- a lost gesture shape or a broken panel. */
test("the click path admits every gesture shape it was fixed to admit", () => {
  const { canvas } = frames(SAMPLE.graph);
  const probe = canvas.__graphProbe!();
  const node = probe[0];
  const at = { clientX: node.x * probe.camZ, clientY: node.y * probe.camZ };
  expect(typeof probe.endGesture).toBe("function");
  expect(() => {
    probe.endGesture({ type: "mouseup", ...at });
    probe.endGesture({ type: "mouseup", ...at }, zoomIdentity.translate(1000, 1000).scale(probe.camZ));
    probe.endGesture({ type: "touchend", changedTouches: [at] });
    probe.endGesture({ type: "touchcancel", changedTouches: [at] });
    probe.endGesture({ type: "touchend", changedTouches: [] });
  }).not.toThrow();
});

describe("edgeWidth", () => {
  test("is thickest for the deck's own strongest edge and thinnest for its weakest", () => {
    expect(edgeWidth(8, 8)).toBeGreaterThan(edgeWidth(1, 8));
    expect(edgeWidth(0, 8)).toBeLessThan(edgeWidth(8, 8));
  });

  test("is monotonic in weight", () => {
    const w = [1, 2, 3, 4].map((x) => edgeWidth(x, 4));
    for (let i = 1; i < w.length; i++) expect(w[i]).toBeGreaterThanOrEqual(w[i - 1]);
  });

  test("does not divide by zero on a deck with no weighted edges", () => {
    expect(Number.isFinite(edgeWidth(0, 0))).toBe(true);
  });
});

test("a card node's radius is the radius its art is drawn at", () => {
  expect(nodeRadius()).toBe(ART_RADIUS);
});

// No context spy here, deliberately: this documents the no-canvas baseline (very old browser, or
// -- in this suite -- every OTHER test in this file) still no-ops safely rather than throwing.
test("attaches no probe when there is no 2D context to draw into", () => {
  const { container } = render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  const canvas = container.querySelector("canvas") as HTMLCanvasElement & { __graphProbe?: () => unknown };
  expect(canvas.__graphProbe).toBeUndefined();
});

test("the probe describes every card's drawn geometry", () => {
  const { canvas } = frames(SAMPLE.graph);
  const nodes = canvas.__graphProbe!();
  expect(nodes.map((n) => n.id).sort()).toEqual(SAMPLE.graph.nodes.map((n) => n.id).sort());
  for (const n of nodes) {
    expect(Number.isFinite(n.x)).toBe(true);
    expect(n.r).toBe(ART_RADIUS);
  }
});

// The drawing-quality metrics (board-quality.ts) need each edge's TARGET distance, which the node
// positions alone cannot say -- without this the probe can report a board but not whether it
// honoured the weights it was given.
test("the probe reports each edge with the distance its weight asked for", () => {
  const { canvas } = frames(SAMPLE.graph);
  const { edges } = canvas.__graphProbe!();
  expect(edges).toHaveLength(1);
  expect(edges[0]).toMatchObject({ from: "Krenko, Mob Boss", to: "Impact Tremors" });
  // One edge, so it IS the deck's maximum and sits at the minimum distance.
  expect(edges[0].target).toBeCloseTo(LINK_DIST_MIN);
});

test("counts a card's synergy partners on the probe", () => {
  const { canvas } = frames(SAMPLE.graph);
  expect(canvas.__graphProbe!().every((n) => n.deg === 1)).toBe(true);
});

// An edge naming a card the graph does not hold must be dropped, not crash the layout. The
// fixtures assert offDeckReasons is 0; this is the runtime half of the same guarantee.
test("survives an edge naming a card that is not in the graph", () => {
  const graph = graphOf(
    [card({ id: "A" })],
    [{ from: "A", to: "Nowhere", weight: 2, tags: [], reasonTexts: [] }],
  );
  const { canvas } = frames(graph);
  expect(canvas.__graphProbe!().edges).toEqual([]);
});

describe("fullscreen toggle", () => {
  let original: typeof Element.prototype.requestFullscreen;

  beforeEach(() => { original = Element.prototype.requestFullscreen; });

  afterEach(() => {
    // jsdom has no requestFullscreen at all, so the real baseline is "no such property" --
    // `original` reads as `undefined` in that case. Assigning `undefined` back would not restore
    // that baseline: it creates an OWN property holding `undefined`, and `"requestFullscreen" in
    // Element.prototype` (the exact capability check the feature uses) is true for an own property
    // regardless of its value.
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
    // regardless of which element it was called on -- the defect ff53076 fixed was the ref moving
    // to the inner canvas container instead of the shell that also wraps the exit button.
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
    // event. fireEvent (not a raw dispatchEvent) wraps this in `act` so the resulting setState is
    // flushed before the assertion.
    Object.defineProperty(document, "fullscreenElement", { value: shell, configurable: true });
    fireEvent(document, new Event("fullscreenchange"));
    expect(getByRole("button", { name: /exit fullscreen/i })).toHaveAttribute("aria-pressed", "true");

    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    fireEvent(document, new Event("fullscreenchange"));
    expect(getByRole("button", { name: /^fullscreen$/i })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("the paint mode", () => {
  test("is a row of chips, not a dropdown, defaulting to Type", () => {
    makeContextSpy();
    render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    for (const m of PAINT_MODES) expect(screen.getByRole("button", { name: m.label })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Type" })).toHaveAttribute("aria-pressed", "true");
  });

  /** THE point of retiring rooms. A room was a FORCE, so changing which facet grouped the board
   *  re-simulated it; paint is a restyle over geometry that means synergy and only synergy, so
   *  every node must sit exactly where it did. */
  test("repaints without moving a single card", () => {
    const { canvas, tick } = frames(SAMPLE.graph);
    tick(50);
    const before = canvas.__graphProbe!().map((n) => ({ id: n.id, x: n.x, y: n.y }));
    fireEvent.click(screen.getByRole("button", { name: "Identity" }));
    expect(canvas.__graphProbe!().map((n) => ({ id: n.id, x: n.x, y: n.y }))).toEqual(before);
  });

  test("changes the hue each card is drawn in", () => {
    const calls: string[] = [];
    const { tick } = frames(SAMPLE.graph, calls);
    /** The strokeStyle each rim arc was drawn with, paired in call order -- asserting the two
     *  independently would pass if every card were drawn in one hue. A rim arc is an ART_RADIUS
     *  arc that is STROKED; the art-loading placeholder draws an arc at the same radius and fills
     *  it, so the following call is what tells them apart. */
    const rimHuesDrawn = () => {
      const hues: string[] = [];
      let pending: string | null = null;
      calls.forEach((c, i) => {
        if (c.startsWith("set:strokeStyle=")) pending = c.slice("set:strokeStyle=".length);
        else if (
          c.startsWith("arc:") && Number(c.split(",")[2]) === ART_RADIUS
          && calls[i + 1] === "stroke:" && pending
        ) {
          hues.push(pending);
        }
      });
      return hues;
    };
    calls.length = 0;
    tick();
    // Krenko is a legendary creature, Impact Tremors an enchantment.
    expect(rimHuesDrawn()).toEqual([TYPE_HUE.creature, TYPE_HUE.enchantment]);

    fireEvent.click(screen.getByRole("button", { name: "Identity" }));
    calls.length = 0;
    tick();
    expect(rimHuesDrawn()).toEqual([IDENTITY_HUE.R, IDENTITY_HUE.R]);

    fireEvent.click(screen.getByRole("button", { name: "Role" }));
    calls.length = 0;
    tick();
    // Both carry the `burn` role, which is a win condition.
    expect(rimHuesDrawn()).toEqual([ROLE_HUE.wincons, ROLE_HUE.wincons]);
  });

  test("keeps pan and zoom when the mode changes", () => {
    const { canvas } = frames(SAMPLE.graph);
    fireEvent.wheel(canvas, { deltaY: -240 });
    const before = canvas.__graphProbe!().camZ;
    // Without this, `before` and the post-switch read are both `undefined` on a build that dropped
    // camZ off the probe entirely, and `undefined === undefined` passes.
    expect(Number.isFinite(before)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Role" }));
    expect(canvas.__graphProbe!().camZ).toBe(before);
  });
});

describe("the paint legend", () => {
  test("names every value in the deck with how many copies carry it", () => {
    makeContextSpy();
    const graph = graphOf([
      card({ id: "Mountain", types: ["land"], copies: 24 }),
      card({ id: "Goblin", types: ["creature"] }),
    ]);
    render(<GraphView graph={graph} report={SAMPLE.report} />);
    const legend = screen.getByTestId("paint-legend");
    expect(legend).toHaveTextContent("land");
    expect(legend).toHaveTextContent("24");
    expect(legend).toHaveTextContent("creature");
  });

  test("relabels itself when the paint mode changes", () => {
    makeContextSpy();
    render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
    const values = () => [...screen.getByTestId("paint-legend").querySelectorAll("[data-value]")]
      .map((el) => el.getAttribute("data-value"));
    expect(values()).toEqual(["creature", "enchantment"]);
    fireEvent.click(screen.getByRole("button", { name: "Identity" }));
    expect(values()).toEqual(["R"]);
  });

  // The canvas binds pointermove/wheel directly on itself, not delegated from the wrapper, so an
  // absolutely-positioned sibling that captured pointer events would put a dead zone over the
  // board wherever it sits.
  test("does not intercept pointer events meant for the canvas", () => {
    makeContextSpy();
    render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
    expect(screen.getByTestId("paint-legend").className).toMatch(/pointer-events-none/);
  });
});

test("the developer controls are hidden until debug is on", () => {
  makeContextSpy();
  render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  expect(screen.queryByRole("button", { name: /^card$/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /^miniature$/i })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^debug$/i }));
  expect(screen.getByRole("button", { name: /^card$/i })).toBeInTheDocument();
});

// Task 4 of the tuning-panel plan: BoardTuner joins the debug rig rather than inventing a second
// way in.
test("the tuning panel is absent until debug is on", async () => {
  makeContextSpy();
  render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  expect(screen.queryByText("tune")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "debug" }));
  expect(screen.getByText("tune")).toBeTruthy();
});

// `params` is GraphView's own state, passed down as a controlled value -- if BoardTuner kept it
// local instead, moving a slider would never reach the simulation and `expect(slider.value)` alone
// would still pass. Reading the CONSTRUCTOR call back (via the spy at the top of this file) is what
// proves params reached the simulation.
test("the tuning panel drives the simulation's constants", async () => {
  makeContextSpy();
  render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  await userEvent.click(screen.getByRole("button", { name: "debug" }));
  const slider = screen.getByLabelText("repulsion") as HTMLInputElement;
  const before = slider.value;
  fireEvent.change(slider, { target: { value: String(Number(before) + 100) } });
  expect(slider.value).not.toBe(before);
  const last = vi.mocked(createBoardSimulation).mock.lastCall![0];
  expect(last.params!.repulsion).not.toBe(DEFAULT_PARAMS.repulsion);
});

describe("search", () => {
  test("renders a search box", () => {
    render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
    expect(screen.getByRole("searchbox", { name: /find a card/i })).toBeInTheDocument();
  });

  test("reports how many cards match what was typed", async () => {
    const user = userEvent.setup();
    render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
    await user.type(screen.getByRole("searchbox", { name: /find a card/i }), "Kren");
    expect(screen.getByTestId("graph-search-count")).toHaveTextContent("1 match");
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
    await user.type(screen.getByRole("searchbox", { name: /find a card/i }), "IMPACT");
    expect(screen.getByTestId("graph-search-count")).toHaveTextContent("1");
  });

  // The context stub records method CALLS, not property assignments, so the ring's colour is
  // invisible to it. What IS reachable is the ring's own arc: it is the only arc drawn at radius
  // ART_RADIUS + 3 (17) anywhere in draw().
  test("draws a ring around a card that matches", () => {
    const calls: string[] = [];
    const { tick } = frames(SAMPLE.graph, calls);
    fireEvent.change(screen.getByRole("searchbox", { name: /find a card/i }), { target: { value: "Krenko" } });
    calls.length = 0;
    tick();
    expect(calls.filter((c) => c.startsWith("arc:") && c.split(",")[2] === "17").length)
      .toBeGreaterThan(0);
  });
});

// Weight is already spent on DISTANCE, so this is redundancy -- but a single batched path can only
// carry one width, which is what the room board drew. Each edge gets its own stroke now.
test("strokes each edge at a width scaled by its weight", () => {
  const graph = graphOf(
    [card({ id: "A" }), card({ id: "B" }), card({ id: "C" })],
    [
      { from: "A", to: "B", weight: 8, tags: [], reasonTexts: [] },
      { from: "A", to: "C", weight: 1, tags: [], reasonTexts: [] },
    ],
  );
  const calls: string[] = [];
  const { tick } = frames(graph, calls);
  calls.length = 0;
  tick();
  // The widths written immediately before an edge stroke, in the order the two edges are drawn.
  const widths: number[] = [];
  let pending: number | null = null;
  for (const c of calls) {
    if (c.startsWith("set:lineWidth=")) pending = Number(c.slice("set:lineWidth=".length));
    else if (c === "moveTo:" || c.startsWith("moveTo:")) { if (pending !== null) widths.push(pending); }
  }
  expect(widths).toHaveLength(2);
  expect(widths[0]).toBeGreaterThan(widths[1]);
});

describe("the camera", () => {
  test("switching to card mode raises the zoom past the card threshold", () => {
    const { canvas } = frames(SAMPLE.graph);
    fireEvent.click(screen.getByRole("button", { name: /^debug$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^card$/i }));
    // Deliberately a literal, not `CARD_MODE_Z`: the button handler passes that same constant, so
    // comparing against it can only catch the button not firing at all. This test's job is to
    // catch the button and the constant DIVERGING. Update by hand if CARD_MODE_Z changes.
    expect(canvas.__graphProbe!().camZ).toBe(4);
  });

  test("scrolling in far enough reaches card mode on its own", () => {
    const { canvas } = frames(SAMPLE.graph);
    // Each tick multiplies cam.z by 1.1 from a start of 1; 30 ticks (~17.4) clears any reasonable
    // ceiling above CARD_MODE_Z with room to spare.
    for (let i = 0; i < 30; i++) fireEvent.wheel(canvas, { deltaY: -240 });
    expect(canvas.__graphProbe!().camZ).toBeGreaterThanOrEqual(CARD_MODE_Z);
  });

  // draw() once applied the camera transform with the origin at the canvas's CENTRE while d3-zoom
  // anchors every wheel/drag at the TOP-LEFT. The two disagreed by half the canvas, so a zoom
  // recentred the board a quarter-viewport away from the cursor -- invisible to every test because
  // jsdom's DEFAULT zero bounding rect makes both terms zero. Deliberately off-centre: at the exact
  // canvas centre the two conventions agree, so a test anchored there ships green with the defect.
  test("wheel-zoom anchors the world point under the cursor, not the canvas centre", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const { canvas } = frames(SAMPLE.graph);
    const at = { clientX: 700, clientY: 100 };
    const before = canvas.__graphProbe!().toWorld(at);
    fireEvent.wheel(canvas, { deltaY: -300, ...at });
    const after = canvas.__graphProbe!().toWorld(at);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });
});

// Defect 2 (task-10 brief): the camera opened at the origin, zoom 1, while the node cloud settled
// somewhere else entirely -- 13 of 84 cards on screen in the fullscreen measurement this reproduces
// (1598x894, sorin). The fixture is the SAME 84-card deck that measurement used, not a synthetic
// stand-in, because a handful of hand-placed nodes cannot reproduce a board wide enough to need a
// real zoom-out.
describe("fit to view", () => {
  // UPDATED for task-11's Defect 1: the fit now frames the CONNECTED cluster, not the whole node
  // cloud, so an orphan (no synergy edge -- a land, on this fixture) is no longer guaranteed to be
  // on screen after the initial fit. It used to be, by construction, when the bounding box was
  // taken over every node; that was Defect 1 (the 36 orphan lands on this exact fixture set the
  // frame and crushed the 48-card connected cluster into ~15% of it -- task-11 brief). This asserts
  // the CONNECTED cards are framed, which is the same claim the old test made minus the orphans it
  // was never supposed to be making a promise about.
  test("frames the connected cluster on screen after mount", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 1598, height: 894, right: 1598, bottom: 894, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const { canvas, tick } = frames(sorinFixture.graph as CardGraph);
    // FIT_SETTLE_ALPHA (GraphView.tsx) sits just past 800 ticks under the shipped ALPHA_DECAY; 1000
    // clears it with margin rather than chasing the exact crossing point.
    tick(1000);
    const probe = canvas.__graphProbe!();
    // The visible WORLD rectangle: the canvas's own corners, inverted through whatever camera the
    // fit landed on -- the same toWorld the pointer handlers use, not a reimplementation.
    const topLeft = probe.toWorld({ clientX: 0, clientY: 0 });
    const bottomRight = probe.toWorld({ clientX: 1598, clientY: 894 });
    const [xMin, xMax] = [topLeft.x, bottomRight.x].sort((a, b) => a - b);
    const [yMin, yMax] = [topLeft.y, bottomRight.y].sort((a, b) => a - b);
    const connected = probe.filter((n) => n.deg > 0);
    expect(connected.length).toBeGreaterThan(0); // sanity: this fixture does have synergy edges
    for (const n of connected) {
      expect(n.x).toBeGreaterThanOrEqual(xMin);
      expect(n.x).toBeLessThanOrEqual(xMax);
      expect(n.y).toBeGreaterThanOrEqual(yMin);
      expect(n.y).toBeLessThanOrEqual(yMax);
    }
  });

  // CAMERA ONLY, same rule as labels.ts: a fit that nudged a node's own x/y (rather than just where
  // the camera looks) would corrupt the very positions that encode synergy. Freezes the simulation
  // (Task 7/8's own pattern) so any drift left over is the fit's doing and nothing else's -- but
  // unlike that pattern, THIS mock's alpha() must return a real number (not the mock object itself):
  // the fit gate reads it as a number to decide whether to fire at all.
  test("a fit writes no node position, only the camera", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    // Starts high so the layout effect's OWN synchronous first tick (before the fit is even wired,
    // see GraphView.tsx's comment on fitToViewPlaceholder) cannot mistake this for a settled board.
    let alpha = 1;
    const frozen = {
      alpha: (v?: number) => { if (v !== undefined) alpha = v; return alpha; },
      tick: () => frozen, stop: () => frozen,
    } as unknown as ReturnType<typeof createBoardSimulation>;
    vi.mocked(createBoardSimulation).mockReturnValueOnce(frozen);
    const { canvas, tick } = frames(SAMPLE.graph);
    const before = canvas.__graphProbe!().map((n) => ({ id: n.id, x: n.x, y: n.y }));
    const zBefore = canvas.__graphProbe!().camZ;
    alpha = 0.01; // now crosses FIT_SETTLE_ALPHA on the next tick
    tick(1);
    expect(canvas.__graphProbe!().map((n) => ({ id: n.id, x: n.x, y: n.y }))).toEqual(before);
    // And the fit really ran -- not a vacuous pass because nothing happened at all.
    expect(canvas.__graphProbe!().camZ).not.toBe(zBefore);
  });

  // THE FIT MUST SURVIVE THE EFFECT BEING TORN DOWN AND RE-RUN FOR THE SAME DECK. React.StrictMode
  // does exactly that on every dev mount (mount, cleanup, mount), and the fit needs ~696 ticks to
  // fire, so the first run is always dead before it fits. The bookkeeping used to be "did an
  // earlier run leave positions behind", which the second run reads as "already fitted" -- so the
  // camera never moved in the real app while every test here passed, because they all drive alpha
  // down by hand on a single mount. Measured in the browser at the time: 74 of 84 cards on screen
  // at zoom 1, versus 84 of 84 at zoom 0.235 with StrictMode off.
  test("still fits when the effect is torn down and re-run for the same deck", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 1598, height: 894, right: 1598, bottom: 894, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    let nextFrame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { nextFrame = cb; return 0; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    makeContextSpy();
    const graph = sorinFixture.graph as CardGraph;
    // The same graph OBJECT through a StrictMode double-mount -- identity is what the fit keys on.
    const { container } = render(
      <StrictMode><GraphView graph={graph} report={SAMPLE.report} /></StrictMode>,
    );
    const canvas = container.querySelector("canvas") as HTMLCanvasElement & {
      __graphProbe?: () => Array<{ id: string; x: number; y: number }> & { camZ: number };
    };
    for (let i = 0; i < 1000; i++) nextFrame!(0);
    expect(canvas.__graphProbe!().camZ).not.toBe(1);
  });

  // Task 11, Defect 1: fitToView took the bounding box over EVERY node, so 36 of 84 orphan lands on
  // the sorin fixture set the frame and the connected cluster -- the entire point of the view -- was
  // compressed into ~15% of it. The fix frames the CONNECTED nodes only (Sim.deg > 0, already
  // computed above this describe block's `links` loop -- see GraphView.tsx).
  test("frames the connected pair and leaves a far-flung orphan outside the viewport", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    // No edge touches C -- mutual repulsion (REPULSION_RANGE 469) pushes it away from the A-B pair
    // over 1000 ticks while the link spring holds A and B together, the same physics the sorin
    // fixture's 36 real orphans are subject to. Verified over 5 seeded trials before writing this
    // test (script discarded, not committed): C lands 370-400 world units from the fitted pair's
    // centre against a fitted half-viewport of 70-73 -- reliably outside, never by luck.
    const graph = graphOf(
      [card({ id: "A" }), card({ id: "B" }), card({ id: "C" })],
      [{ from: "A", to: "B", weight: 1, tags: [], reasonTexts: [] }],
    );
    const { canvas, tick } = frames(graph);
    tick(1000);
    const probe = canvas.__graphProbe!();
    const topLeft = probe.toWorld({ clientX: 0, clientY: 0 });
    const bottomRight = probe.toWorld({ clientX: 300, clientY: 200 });
    const [xMin, xMax] = [topLeft.x, bottomRight.x].sort((a, b) => a - b);
    const [yMin, yMax] = [topLeft.y, bottomRight.y].sort((a, b) => a - b);
    const a = probe.find((n) => n.id === "A")!;
    const b = probe.find((n) => n.id === "B")!;
    const c = probe.find((n) => n.id === "C")!;
    for (const n of [a, b]) {
      expect(n.x).toBeGreaterThanOrEqual(xMin);
      expect(n.x).toBeLessThanOrEqual(xMax);
      expect(n.y).toBeGreaterThanOrEqual(yMin);
      expect(n.y).toBeLessThanOrEqual(yMax);
    }
    // Fills a SANE FRACTION of the frame -- the pair's own span is a third or more of the
    // viewport's tighter axis, not lost in a much wider frame built to also fit the orphan.
    const viewSpan = Math.min(xMax - xMin, yMax - yMin);
    const pairSpan = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
    expect(pairSpan / viewSpan).toBeGreaterThan(0.3);
    // The orphan is genuinely off camera, not merely far in world units.
    const orphanOutside = c.x < xMin || c.x > xMax || c.y < yMin || c.y > yMax;
    expect(orphanOutside).toBe(true);
  });

  // Defect 1's other half: a deck whose graph has zero edges (nothing to filter down to) must
  // still be framed by ALL its nodes, not divided by an empty bounding box.
  test("still frames every node when the graph has no edges at all", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const graph = graphOf([card({ id: "A" }), card({ id: "B" }), card({ id: "C" })]);
    const { canvas, tick } = frames(graph);
    tick(1000);
    const probe = canvas.__graphProbe!();
    expect(Number.isFinite(probe.camZ)).toBe(true);
    const topLeft = probe.toWorld({ clientX: 0, clientY: 0 });
    const bottomRight = probe.toWorld({ clientX: 300, clientY: 200 });
    const [xMin, xMax] = [topLeft.x, bottomRight.x].sort((a, b) => a - b);
    const [yMin, yMax] = [topLeft.y, bottomRight.y].sort((a, b) => a - b);
    for (const n of probe) {
      expect(n.x).toBeGreaterThanOrEqual(xMin);
      expect(n.x).toBeLessThanOrEqual(xMax);
      expect(n.y).toBeGreaterThanOrEqual(yMin);
      expect(n.y).toBeLessThanOrEqual(yMax);
    }
  });

  // The board takes ~696 ticks to reach FIT_SETTLE_ALPHA -- seconds of real time -- so a user can
  // easily zoom BEFORE the one-time fit fires. Until this guard, the pending fit then overwrote the
  // camera they had just set. "Fit once per deck" was true and still let this through: the camera
  // the user moved was not yet the "settled" one the bookkeeping was tracking.
  test("a user's own zoom cancels the pending fit rather than being overwritten by it", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    let alpha = 1; // still settling, so the fit has NOT fired yet
    const frozen = {
      alpha: (v?: number) => { if (v !== undefined) alpha = v; return alpha; },
      tick: () => frozen, stop: () => frozen,
    } as unknown as ReturnType<typeof createBoardSimulation>;
    vi.mocked(createBoardSimulation).mockReturnValueOnce(frozen);
    const { canvas, tick } = frames(SAMPLE.graph);

    // A real gesture, which is what `sourceEvent` distinguishes: endGesture passes the event
    // through to d3-zoom exactly as production does.
    act(() => {
      canvas.__graphProbe!().endGesture(
        { type: "mouseup", clientX: 10, clientY: 10 },
        zoomIdentity.translate(5, 5).scale(3),
      );
    });
    const zAfterUser = canvas.__graphProbe!().camZ;
    expect(zAfterUser).toBe(3);

    alpha = 0.01; // the board settles -- the fit would fire here if the gesture had not cancelled it
    tick(2);
    expect(canvas.__graphProbe!().camZ).toBe(zAfterUser);
  });

  // Task 11 FIX ROUND: fitToView computed a camera once, against whatever the canvas measured at
  // that instant, and never again -- so the normal way this board is viewed (open small, then go
  // fullscreen) kept a camera framed for a pane a third the area of the real canvas. Measured in the
  // browser (sorin fixture, in-tab 1534x518 -> fullscreen 1598x894): zoom stayed 0.538 across the
  // resize where 1.053 was what actually fit. Reproduced here with a synthetic A-B pair rather than
  // the sorin fixture, so the shrink (300x200 -> 100x67, same aspect ratio, a third the size) is
  // large enough to be unmissable regardless of exactly where FIT_SETTLE_ALPHA lands the physics.
  //
  // FIX ROUND 2: driven through the captured ResizeObserver callback, not `window.dispatchEvent(new
  // Event("resize"))`. That was the bug this round fixes -- entering ELEMENT fullscreen (the button
  // on this board) resizes the canvas's own box without ever firing a window "resize" event in
  // Chrome (measured live, task-11 fix round 2 brief), so a test that only ever dispatches that
  // event cannot tell a working fix from one that still silently depends on it. Not dispatching a
  // window resize here at all is the point.
  test("refits the camera when the canvas resizes while the fit still owns it", () => {
    const rectSpy = vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const ro = stubResizeObserver();
    const graph = graphOf(
      [card({ id: "A" }), card({ id: "B" }), card({ id: "C" })],
      [{ from: "A", to: "B", weight: 1, tags: [], reasonTexts: [] }],
    );
    const { canvas, tick } = frames(graph);
    tick(1000); // settle and let the initial fit fire at the ORIGINAL 300x200
    // The observer really is watching the canvas, not e.g. its shell div or the window -- a wiring
    // bug that a callback-only assertion would not catch.
    expect(ro.observe).toHaveBeenCalledWith(canvas);

    rectSpy.mockReturnValue({
      left: 0, top: 0, width: 100, height: 67, right: 100, bottom: 67, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    act(() => { ro.fire(); });

    const probe = canvas.__graphProbe!();
    const topLeft = probe.toWorld({ clientX: 0, clientY: 0 });
    const bottomRight = probe.toWorld({ clientX: 100, clientY: 67 });
    const [xMin, xMax] = [topLeft.x, bottomRight.x].sort((a, b) => a - b);
    const [yMin, yMax] = [topLeft.y, bottomRight.y].sort((a, b) => a - b);
    const a = probe.find((n) => n.id === "A")!;
    const b = probe.find((n) => n.id === "B")!;
    // Without a refit, the camera set for the 300x200 pane still shows the SAME world span, which
    // does not fit inside a canvas a third the size -- A and/or B land outside it.
    for (const n of [a, b]) {
      expect(n.x).toBeGreaterThanOrEqual(xMin);
      expect(n.x).toBeLessThanOrEqual(xMax);
      expect(n.y).toBeGreaterThanOrEqual(yMin);
      expect(n.y).toBeLessThanOrEqual(yMax);
    }
  });

  // The other half of the same brief: a resize must NOT overwrite a camera the user has already
  // taken over -- the exact promise the pre-fix `onResize` comment made ("would fight a user who has
  // already panned"), which this fix must not lose. Driven through the observer callback for the
  // same reason as the test above.
  test("does not refit on resize once the user has moved the camera", () => {
    const rectSpy = vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const ro = stubResizeObserver();
    const { canvas, tick } = frames(SAMPLE.graph);
    tick(1000);

    act(() => {
      canvas.__graphProbe!().endGesture(
        { type: "mouseup", clientX: 10, clientY: 10 },
        zoomIdentity.translate(5, 5).scale(3),
      );
    });
    const afterUser = canvas.__graphProbe!().camZ;
    expect(afterUser).toBe(3); // sanity: the gesture really did land

    rectSpy.mockReturnValue({
      left: 0, top: 0, width: 1598, height: 894, right: 1598, bottom: 894, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    act(() => { ro.fire(); });
    expect(canvas.__graphProbe!().camZ).toBe(afterUser);
  });

  // The leak this round's brief calls out by name: a ResizeObserver left connected after React has
  // torn the canvas down holds a live reference to a detached element for the life of the page, and
  // this effect re-runs on every deck (`graph` in the dependency array a few lines below), so a
  // long session accumulates one per deck ever opened.
  test("disconnects the resize observer on unmount", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const ro = stubResizeObserver();
    makeContextSpy();
    const { unmount } = render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
    expect(ro.disconnect).not.toHaveBeenCalled();
    unmount();
    expect(ro.disconnect).toHaveBeenCalledTimes(1);
  });
});

// Card mode paints a 5:7 RECTANGLE (ART_RADIUS*2 wide, *1.4 tall); circular chrome stroked over it
// is the defect these three protect against.
function cardModeFrame(graph: CardGraph) {
  const calls: string[] = [];
  const { tick } = frames(graph, calls);
  fireEvent.click(screen.getByRole("button", { name: /^debug$/i }));
  fireEvent.click(screen.getByRole("button", { name: /^card$/i }));
  calls.length = 0;          // discard the mount frame, drawn in miniature mode
  tick();
  return calls;
}

test("a multi-copy card in card mode stacks rectangles, not circles", () => {
  const calls = cardModeFrame(graphOf([card({ id: "Relentless Rats", copies: 9 })]));
  expect(calls.filter((c) => c.startsWith("strokeRect:")).length).toBeGreaterThanOrEqual(2);
  expect(calls.filter((c) => c.startsWith("arc:") && c.split(",")[2] === String(ART_RADIUS)))
    .toEqual([]);
});

test("a card in card mode shows its paint hues as bars, not rim arcs", () => {
  const calls = cardModeFrame(graphOf([card({ id: "Bojuka Bog", types: ["land", "creature"] })]));
  // Structural, not a literal-string match against draw()'s canvas-wide background wipe: a paint
  // bar is the only fillRect whose height is BAR_H (3) -- a module-private constant, so its value
  // is repeated here. The wipe and the art-loading placeholder both have some other height.
  const bars = calls.filter((c) => {
    if (!c.startsWith("fillRect:")) return false;
    return Number(c.slice("fillRect:".length).split(",")[3]) === 3;
  });
  expect(bars).toHaveLength(2);
  for (const bar of bars) {
    const [, , w, h] = bar.slice("fillRect:".length).split(",").map(Number);
    expect(w).toBeCloseTo(ART_RADIUS, 6); // 28 / 2 values
    expect(h).toBe(3);
  }
  expect(calls.filter((c) => c.startsWith("arc:") && c.split(",")[2] === String(ART_RADIUS)))
    .toEqual([]);
  // The card carries no artCrop, so the art-not-loaded placeholder fires and fills the whole card
  // box -- which proves the height filter above does not count it as a third bar.
  const placeholder = calls.find((c) => {
    if (!c.startsWith("fillRect:")) return false;
    const [, , w, h] = c.slice("fillRect:".length).split(",").map(Number);
    return w === ART_RADIUS * 2 && Math.abs(h - ART_RADIUS * 2 * 1.4) < 1e-6;
  });
  expect(placeholder).toBeDefined();
  expect(bars).not.toContain(placeholder);
});

// LABELS HAD A FLOOR BUT NO CEILING: they start above LABEL_ZOOM_FLOOR and never stopped, so from
// CARD_MODE_Z (4) to MAX_Z (8) a name was painted over a card whose own art already prints it.
// The suppressing branch is unit-tested on `labelCandidates` in labels.test.ts, not here — jsdom
// cannot load an image, so every card in this harness draws as a PLACEHOLDER and the branch is
// unreachable through the component. Same reason `traveledAsPan` is a pure function.
//
// What this pins is the carve-out, which IS reachable: a card with no art drawn keeps its label,
// because nothing else on screen names it.
test("a card mode placeholder keeps its label, having no art to name it", () => {
  const calls = cardModeFrame(graphOf([card({ id: "Bojuka Bog" })]));
  expect(calls.filter((c) => c.startsWith("fillText:Bojuka Bog")).length).toBeGreaterThan(0);
});

test("the search-match ring in card mode is a rectangle around the card box", () => {
  const calls: string[] = [];
  const { tick } = frames(graphOf([card({ id: "Bojuka Bog" })]), calls);
  fireEvent.click(screen.getByRole("button", { name: /^debug$/i }));
  fireEvent.click(screen.getByRole("button", { name: /^card$/i }));
  fireEvent.change(screen.getByRole("searchbox", { name: /find a card/i }), { target: { value: "Bojuka" } });
  calls.length = 0;
  tick();
  // Outset 3 on every side of the 28x39.2 box.
  const ring = calls.find((c) => {
    const [, , w, h] = c.startsWith("strokeRect:") ? c.slice("strokeRect:".length).split(",").map(Number) : [];
    return w === ART_RADIUS * 2 + 6 && Math.abs(h - (ART_RADIUS * 2 * 1.4 + 6)) < 1e-6;
  });
  expect(ring).toBeDefined();
  // Never the old circular ring at ART_RADIUS + 3.
  expect(calls.filter((c) => c.startsWith("arc:") && c.split(",")[2] === "17")).toEqual([]);
});

// jsdom's getBoundingClientRect is all-zero and the camera starts at its identity, so toWorld's own
// math collapses to clientX/clientY == world coordinates: a pointermove fired at a probed node's
// exact (x, y) lands on it with no prediction required.
describe("hover", () => {
  test("shows a card's build role translated to plain language", () => {
    const { canvas } = frames(graphOf([card({ id: "Sol Ring", types: ["artifact"], roles: ["ramp"] })]));
    const node = canvas.__graphProbe!()[0];
    fireEvent(canvas, new MouseEvent("pointermove", { clientX: node.x, clientY: node.y, bubbles: true }));
    // "ramp" is the raw category key; subcategoryLabel("ramp") is "extra mana", so asserting the
    // translated text proves the tooltip went through it rather than echoing the role verbatim.
    expect(screen.getByText(/extra mana/)).toBeInTheDocument();
  });

  test("names the card and how many partners it has", () => {
    const { canvas } = frames(SAMPLE.graph);
    const node = canvas.__graphProbe!().find((n) => n.id === "Krenko, Mob Boss")!;
    fireEvent(canvas, new MouseEvent("pointermove", { clientX: node.x, clientY: node.y, bubbles: true }));
    expect(screen.getByText(/Krenko, Mob Boss/)).toBeInTheDocument();
    expect(screen.getByText(/1 partners/)).toBeInTheDocument();
  });

  test("clears when the pointer is over empty board space", () => {
    const { canvas } = frames(graphOf([card({ id: "Sol Ring", roles: ["ramp"] })]));
    const node = canvas.__graphProbe!()[0];
    fireEvent(canvas, new MouseEvent("pointermove", { clientX: node.x, clientY: node.y, bubbles: true }));
    expect(screen.getByText(/extra mana/)).toBeInTheDocument();
    fireEvent(canvas, new MouseEvent("pointermove", { clientX: node.x + 9000, clientY: node.y, bubbles: true }));
    expect(screen.queryByText(/extra mana/)).toBeNull();
  });

  // THE WHOLE POINT OF PREFETCHING ON HOVER rather than fetching `normal` for every card: at
  // whole-deck zoom it must cost NOTHING. The rejected alternative (one `normal` per card, cropped
  // for the disc) added ~2.5MB to a 100-card deck's opening load to save ~75KB per card actually
  // zoomed into. The camera starts at identity here, which is below PREFETCH_Z, so a hover at
  // default zoom is exactly that case. The positive side of the threshold is unit-tested on
  // `shouldPrefetchCard` — jsdom cannot construct the d3-zoom gesture that would raise cam.z.
  test("hovering at whole-deck zoom fetches no full-card image", async () => {
    // Typed args, not `vi.fn(() => ...)`: an empty parameter list gives the spy an empty tuple for
    // `mock.calls`, and reading `c[0]` off it is a type error rather than the URL we came for.
    const fetchSpy = vi.fn((_url: unknown) => Promise.reject(new Error("no network in this test")));
    vi.stubGlobal("fetch", fetchSpy);
    const { canvas } = frames(graphOf([
      card({ id: "Sol Ring", artCrop: "https://cards.example/art_crop/front/a/b/x.jpg" }),
    ]));
    const node = canvas.__graphProbe!()[0];
    fireEvent(canvas, new MouseEvent("pointermove", { clientX: node.x, clientY: node.y, bubbles: true }));
    // The loader spaces dispatches 75ms apart, so a prefetch would be the SECOND request and would
    // not have left the queue yet — asserting immediately here would pass whether or not it fired,
    // which is decoration. Drain the queue first, then look.
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 250));
    expect(fetchSpy.mock.calls.map((c) => String(c[0]))).toEqual([
      "https://cards.example/art_crop/front/a/b/x.jpg",
    ]);
  });
});

// The paint-mode half of "labels never touch geometry" is already covered by "repaints without
// moving a single card" above (Task 5) -- that one pins x/y across a facet switch. This is the
// zoom half: crossing LABEL_ZOOM_FLOOR turns the label pass on, and it must be just as inert.
describe("labels", () => {
  // An ordinary tick already moves a node a little regardless of labels -- board-force.ts's
  // ALPHA_FLOOR keeps the simulation's alpha above zero forever, so it never fully damps out (see
  // its own doc comment). Comparing positions across a real tick would therefore fail on physics
  // drift alone and prove nothing about labels specifically. This freezes the simulation itself
  // (via the createBoardSimulation spy declared at the top of this file) to a no-op, leaving x/y
  // untouched by anything except draw() -- so any drift left over is the label pass's doing and
  // nothing else's.
  test("writes no node position when the label pass draws at a high zoom", () => {
    const frozen = {
      alpha: () => frozen, tick: () => frozen, stop: () => frozen,
    } as unknown as ReturnType<typeof createBoardSimulation>;
    vi.mocked(createBoardSimulation).mockReturnValueOnce(frozen);
    const { canvas, tick } = frames(SAMPLE.graph);
    const before = canvas.__graphProbe!().map((n) => ({ id: n.id, x: n.x, y: n.y }));
    // d3-zoom's wheelDelta puts this at k = 2^0.6 ~ 1.52, up from the default 1. That is well
    // ABOVE LABEL_ZOOM_FLOOR (0.6), not across it -- the point is to be in the zoom band where
    // every node is a label candidate, which is the widest the pass ever runs.
    fireEvent.wheel(canvas, { deltaY: -300 });
    tick(3); // runs draw() -- and therefore the label pass -- with the simulation frozen
    expect(canvas.__graphProbe!().map((n) => ({ id: n.id, x: n.x, y: n.y }))).toEqual(before);
  });

  // Owner's call, 2026-08-13: a search dims non-matching LABELS the same way it already dims
  // non-matching NODES, rather than leaving names at full strength while their cards fade.
  test("dims a non-matching card's label and leaves a matching one at full strength", () => {
    const calls: string[] = [];
    const { tick } = frames(graphOf([card({ id: "Sol Ring" }), card({ id: "Mind Stone" })]), calls);
    fireEvent.change(screen.getByRole("searchbox", { name: /find a card/i }), { target: { value: "Sol Ring" } });
    calls.length = 0; // discard the mount frame, drawn before the query took effect
    tick();

    // Every draw call the label pass makes is a `set:globalAlpha=` immediately followed by its
    // `fillText:<label>,...` -- the alpha nearest before a given label's fillText is what it
    // actually rendered at.
    const trace = calls.filter((c) => c.startsWith("set:globalAlpha=") || c.startsWith("fillText:"));
    const alphaBeforeLabel = (name: string) => {
      const i = trace.findIndex((c) => c.startsWith(`fillText:${name}`));
      expect(i).toBeGreaterThan(-1);
      for (let j = i - 1; j >= 0; j--) if (trace[j].startsWith("set:globalAlpha=")) return trace[j];
      return null;
    };
    expect(alphaBeforeLabel("Sol Ring")).toBe("set:globalAlpha=1");
    expect(alphaBeforeLabel("Mind Stone")).toBe("set:globalAlpha=0.15");
  });

  // Canvas state is global and survives the frame that set it, so a search left dimming on leaks
  // into the NEXT frame's background wipe. The label pass resets it; nothing proved the reset was
  // there. Deleting that one line left all 273 tests green, which is how this test came to exist.
  //
  // The query deliberately matches NOTHING, so every label is dimmed and the last alpha the frame
  // sets can only be the reset. A query that matched something would pass by luck whenever the
  // priority order happened to draw a match last.
  test("leaves globalAlpha reset after the label pass, so dimming cannot leak into the next frame", () => {
    const calls: string[] = [];
    const { tick } = frames(graphOf([card({ id: "Sol Ring" }), card({ id: "Mind Stone" })]), calls);
    fireEvent.change(screen.getByRole("searchbox", { name: /find a card/i }), { target: { value: "zzz" } });
    calls.length = 0;
    tick();

    const alphas = calls.filter((c) => c.startsWith("set:globalAlpha="));
    expect(alphas).toContain("set:globalAlpha=0.15"); // the search really is dimming
    expect(alphas.at(-1)).toBe("set:globalAlpha=1"); // and the frame does not end that way
  });
});

// The click path's arithmetic (traveledAsPan) and its wiring (endGesture admitting all four
// gesture shapes) are proven above; this is what Task 5's comment on that test predicted --
// turning each shape into an assertion about the inspector, now that Task 8 gave the handler a
// body. Driven through the same `endGesture` probe hook for the same reason: jsdom cannot
// construct a real mousedown-driven zoom gesture (see the comment on `traveledAsPan`'s tests
// above), and `endGesture` is the exact production `zoomBehavior.transform` call, not a
// reimplementation. jsdom's all-zero getBoundingClientRect and the camera's identity start mean
// `toWorld` collapses to clientX/clientY == world coordinates here (see the `hover` describe
// block's own comment above), so `{ clientX: node.x, clientY: node.y }` lands exactly on it.
// Task 12: a blind judge, given only a screenshot of a correctly-fitted, labelled board, named two
// EDGELESS lands as the deck's most strongly related pair -- reading their arbitrary
// repulsion-and-centre-pull proximity, plus a matching paint-mode ring colour, as a relationship.
// The fix is paint only: an edgeless card must not carry the same colour or visual weight as a
// connected one, so proximity alone can no longer read as synergy.
describe("edgeless cards", () => {
  test("an edgeless card draws smaller, fainter, and without its paint hue, unlike a connected one", () => {
    const calls: string[] = [];
    const graph = graphOf(
      [card({ id: "A" }), card({ id: "B" }), card({ id: "C" })],
      [{ from: "A", to: "B", weight: 1, tags: [], reasonTexts: [] }],
    );
    const { tick } = frames(graph, calls);
    calls.length = 0;
    tick();

    // No search is active, so the ONLY thing that can put a sub-1 globalAlpha on this frame is the
    // edgeless demotion -- C has no edge, A and B do.
    const alphas = calls
      .filter((c) => c.startsWith("set:globalAlpha="))
      .map((c) => Number(c.slice("set:globalAlpha=".length)));
    expect(alphas.some((a) => a < 1)).toBe(true);
    expect(alphas.some((a) => a === 1)).toBe(true);

    // The edgeless card's circle (rim, cover-fit clip, or placeholder -- whichever branch its art
    // takes) is drawn at a radius smaller than a connected card's, not just a fainter one.
    const radii = calls
      .filter((c) => c.startsWith("arc:"))
      .map((c) => Number(c.split(",")[2]));
    expect(radii.some((r) => r < ART_RADIUS)).toBe(true);
    expect(radii.some((r) => r === ART_RADIUS)).toBe(true);

    // The rim never carries a paint hue for an edgeless card -- suppressing the "matching ring
    // colour" cue the judge actually used, not just dimming a still-coloured ring.
    const rimStrokes: string[] = [];
    let pendingStroke: string | null = null;
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      if (c.startsWith("set:strokeStyle=")) pendingStroke = c.slice("set:strokeStyle=".length);
      else if (c.startsWith("arc:") && calls[i + 1] === "stroke:" && pendingStroke) {
        rimStrokes.push(pendingStroke);
      }
    }
    // A and B (creatures, default fixture colour) get the Type-mode creature hue; C, edgeless,
    // never does.
    expect(rimStrokes).toContain(TYPE_HUE.creature);
    expect(rimStrokes.filter((h) => h === TYPE_HUE.creature).length).toBeLessThan(3);
  });

  test("an edgeless card that matches an active search still shows at full strength", () => {
    const calls: string[] = [];
    const graph = graphOf([card({ id: "Sol Ring" }), card({ id: "Mind Stone" })]);
    const { tick } = frames(graph, calls);
    fireEvent.change(screen.getByRole("searchbox", { name: /find a card/i }), { target: { value: "Sol Ring" } });
    calls.length = 0;
    tick();
    // Asserting "some alpha in the frame is 1" is what this test used to do, and it could not fail:
    // the LABEL pass writes alpha 1 for a matched card independently of the node pass, so dropping
    // the search override from `demote` left it green. Assert on the node's own DISC instead --
    // its radius is the one thing only the node pass writes.
    const radii = calls
      .filter((c) => c.startsWith("arc:"))
      .map((c) => Number(c.slice("arc:".length).split(",")[2]));
    // Sol Ring is edgeless AND matched: search intent wins, so its disc keeps FULL radius while
    // Mind Stone -- edgeless and unmatched -- is drawn shrunken.
    expect(radii).toContain(ART_RADIUS);
    expect(radii.some((r) => r > 0 && r < ART_RADIUS)).toBe(true);
  });
});

describe("the caption", () => {
  // The Fullscreen API only keeps the TARGET element (and its descendants) visible; a sibling
  // outside it is masked the instant fullscreen activates. This asserts the actual mechanism that
  // makes the caption survive the transition -- containment in the DOM tree -- rather than
  // something jsdom's fullscreen stub could fake.
  test("lives inside the fullscreen shell, not as a sibling fullscreen would hide", () => {
    render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
    const shell = screen.getByTestId("graph-fullscreen-shell");
    const caption = screen.getByText(/Drag to pan, scroll to zoom/);
    expect(shell.contains(caption)).toBe(true);
  });
});

describe("the inspector", () => {
  test("a click that does not pan opens the inspector on the card underneath it", () => {
    const { canvas } = frames(SAMPLE.graph);
    const probe = canvas.__graphProbe!();
    const node = probe.find((n) => n.id === "Krenko, Mob Boss")!;
    act(() => { probe.endGesture({ type: "mouseup", clientX: node.x, clientY: node.y }); });
    expect(screen.getByText("Krenko, Mob Boss")).toBeInTheDocument();
    // Krenko is the PRODUCER on the fixture's one edge -- the row has to read card-first, and the
    // reason text that justified the edge has to be reachable too.
    expect(screen.getByText(/Krenko, Mob Boss → Impact Tremors/)).toBeInTheDocument();
    expect(screen.getByText(/pays off tokens/)).toBeInTheDocument();
  });

  test("a click at the end of a pan does not open the inspector", () => {
    const { canvas } = frames(SAMPLE.graph);
    const probe = canvas.__graphProbe!();
    const node = probe.find((n) => n.id === "Krenko, Mob Boss")!;
    act(() => {
      probe.endGesture(
        { type: "mouseup", clientX: node.x, clientY: node.y },
        zoomIdentity.translate(1000, 1000).scale(probe.camZ),
      );
    });
    expect(screen.queryByText("Krenko, Mob Boss")).toBeNull();
  });

  test("the touch tap path opens the inspector too, and a cancelled touch does not", () => {
    const { canvas } = frames(SAMPLE.graph);
    const probe = canvas.__graphProbe!();
    const node = probe.find((n) => n.id === "Impact Tremors")!;
    const at = { clientX: node.x, clientY: node.y };
    act(() => { probe.endGesture({ type: "touchcancel", changedTouches: [at] }); });
    expect(screen.queryByText("Impact Tremors")).toBeNull();
    act(() => { probe.endGesture({ type: "touchend", changedTouches: [at] }); });
    expect(screen.getByText("Impact Tremors")).toBeInTheDocument();
  });

  test("the close button dismisses the panel, and so does clicking empty board space", () => {
    const { canvas } = frames(SAMPLE.graph);
    const probe = canvas.__graphProbe!();
    const node = probe.find((n) => n.id === "Krenko, Mob Boss")!;
    act(() => { probe.endGesture({ type: "mouseup", clientX: node.x, clientY: node.y }); });
    expect(screen.getByText("Krenko, Mob Boss")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByText("Krenko, Mob Boss")).toBeNull();

    act(() => { probe.endGesture({ type: "mouseup", clientX: node.x, clientY: node.y }); });
    expect(screen.getByText("Krenko, Mob Boss")).toBeInTheDocument();
    act(() => {
      probe.endGesture({ type: "mouseup", clientX: node.x + 9000, clientY: node.y });
    });
    expect(screen.queryByText("Krenko, Mob Boss")).toBeNull();
  });
});
