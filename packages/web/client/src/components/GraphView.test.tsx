import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ART_RADIUS, copiesByNameOf, DIM_BY_DEFAULT, GraphView, nodeRadius, placeRoomLabel, roomAttraction, seedPosition, separation } from "./GraphView.js";
import { SAMPLE } from "../fixtures.js";
import type { GraphNode } from "../types.js";
import { ROOM_HUE, ROOMS, type RoomTally } from "./deck-rooms.js";

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
    set(_t, prop: string, value: unknown) {
      calls.push(`set:${prop}=${String(value)}`);
      return true;
    },
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

test("draws a stroked circle for every one of the seven rooms", () => {
  const calls = makeContextSpy();
  render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  // Room outlines are arcs far larger than a card disc (ART_RADIUS 14) or the search-match ring
  // (17), so a bare stroke() immediately after a large arc can only be a room -- the >20 filter is
  // what the old, pre-Task-6 version of this test (any arc-then-stroke pair, no size check) lacked,
  // which also matched card-disc/copy-stack/art-border strokes. 20 rather than 30: an empty room
  // with no target at all still has to be visible ("BOARD WIPES 0/3" is the finding), so it draws
  // at deck-rooms.ts's EMPTY_BASE_R (26) -- comfortably past the card sizes above, but a 30 cutoff
  // would exclude that legitimate case.
  //
  // Counted rather than deduplicated by radius (as an earlier draft of this test did): SAMPLE's
  // buildCategories gives draw, ramp, and targetedRemoval the same target (10), so cardAdvantage,
  // ramp, and interaction -- all empty here -- legitimately draw at the SAME radius (an empty
  // room's size is a pure function of its target, by design; see deck-rooms.ts). Requiring seven
  // *distinct* radii would fail on that coincidence even though all seven rooms are drawn
  // correctly, so distinctness is the wrong thing to assert -- count is.
  const roomOutlines = calls.filter(
    (c, i) => c === "stroke:" && calls[i - 1]?.startsWith("arc:") && Number(calls[i - 1].split(",")[2]) > 20,
  );
  expect(roomOutlines.length).toBeGreaterThanOrEqual(ROOMS.length);
});

test("labels every room, including one holding no cards", () => {
  const calls = makeContextSpy();
  render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  const texts = calls.filter((c) => c.startsWith("fillText:")).map((c) => c.slice("fillText:".length));
  for (const room of ROOMS) {
    expect(texts.some((t) => t.startsWith(room.label.toUpperCase()))).toBe(true);
  }
});

test("labels a room above its circle's rim, not at its centre", () => {
  const calls = makeContextSpy();
  render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  // draw()'s room loop emits, per room: beginPath+arc+fill (the wash), beginPath+arc+stroke (the
  // outline), fillText (the label) -- with only property writes (font, fillStyle, etc, now
  // recorded as `set:` entries by makeContextSpy) between the outline's stroke and its label.
  // Walking back from a fillText, skipping `set:` entries, lands on that same room's stroke and
  // then its arc.
  //
  // That pattern alone isn't unique to rooms, though: a card's rim also ends in stroke:-after-arc:,
  // and the last thing drawn before the hub-label loop is whatever card came last, so the same
  // skip-only-sets walk backward from a HUB label would otherwise land on a card's rim arc too.
  // The >20 radius check (same threshold as "draws a stroked circle for every one of the seven
  // rooms" above) is what disambiguates: card rims are ART_RADIUS (14), room outlines are not.
  let matched = 0;
  for (let i = 0; i < calls.length; i++) {
    if (!calls[i].startsWith("fillText:")) continue;
    let j = i - 1;
    while (j >= 0 && calls[j].startsWith("set:")) j--;
    if (calls[j] !== "stroke:") continue;
    let k = j - 1;
    while (k >= 0 && calls[k].startsWith("set:")) k--;
    if (!calls[k]?.startsWith("arc:")) continue;
    const [, cy, r] = calls[k].slice("arc:".length).split(",");
    if (Number(r) <= 20) continue;
    const [, labelY] = calls[i].slice("fillText:".length).split(",").slice(-2);
    matched++;
    // Above the rim, not just above the centre: a label at the centre (the old, wrong behaviour --
    // see GraphView.tsx's "lands under the cards it describes" comment) would fail this, since
    // centre y is never less than rim y (cy - r) for a circle with r > 0.
    expect(Number(labelY)).toBeLessThan(Number(cy) - Number(r));
  }
  expect(matched).toBeGreaterThanOrEqual(ROOMS.length);
});

test("a card in two rooms draws one rim arc per room, each in that room's hue", () => {
  const calls = makeContextSpy();
  // Bojuka Bog is a land with removal: lands + interaction, so two arcs.
  const graph = {
    nodes: [{ id: "card:bog", kind: "card", label: "Bojuka Bog", roles: ["lands", "targetedRemoval"] }],
    edges: [],
  } as unknown as typeof SAMPLE.graph;
  const report = { ...SAMPLE.report, combos: [], archetypes: [] };
  render(<GraphView graph={graph} report={report} />);

  // Each rim arc is preceded by the strokeStyle write that colours it. Walk the call list in
  // order and pair them, rather than asserting the two sets independently -- which would pass
  // if both arcs were drawn in one hue.
  const hues: string[] = [];
  let pending: string | null = null;
  for (const c of calls) {
    if (c.startsWith("set:strokeStyle=")) pending = c.slice("set:strokeStyle=".length);
    else if (c.startsWith("arc:")) {
      const [, , r, from, to] = c.split(",");
      const isRim = Number(r) === ART_RADIUS && Number(to) - Number(from) < Math.PI * 1.99;
      if (isRim && pending) hues.push(pending);
    }
  }
  expect(hues).toEqual([ROOM_HUE.lands, ROOM_HUE.interaction]);
});

test("placeRoomLabel leaves a label alone when nothing is already there", () => {
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  const y = placeRoomLabel(100, -50, 40, 16, placed);
  expect(y).toBe(-50);
  expect(placed).toEqual([{ x: 80, y: -66, w: 40, h: 16 }]);
});

test("placeRoomLabel pushes a colliding label up until its box clears the one already placed", () => {
  const placed = [{ x: 80, y: -66, w: 40, h: 16 }]; // occupies x:[80,120] y:[-66,-50]
  // A second label centred at the same x, same baseY -- its default box is identical to the one
  // above, so it collides on the first attempt and must move.
  const y = placeRoomLabel(100, -50, 40, 16, placed);
  expect(y).not.toBe(-50);
  expect(y).toBeLessThan(-50); // pushed up (more negative), never sideways or down
  const box = { x: 80, y: y - 16, w: 40, h: 16 };
  const clash = box.y < placed[0].y + placed[0].h && box.y + box.h > placed[0].y;
  expect(clash).toBe(false);
});

test("placeRoomLabel does not move a label that would not collide, even with others already placed", () => {
  const placed = [{ x: 500, y: -66, w: 40, h: 16 }]; // far away in x
  const y = placeRoomLabel(100, -50, 40, 16, placed);
  expect(y).toBe(-50);
});

// A DIFFERENT defect than two labels colliding with each other: a label's default spot can sit
// inside a THIRD room's circle -- CARD ADVANTAGE's label found partly painted over by LANDS's own
// wash+stroke at 1440x900 whole-deck zoom (LANDS drawn later in ROOMS order, so its fill lands on
// top of CARD ADVANTAGE's already-drawn text). placeRoomLabel takes every occupied room's circle
// as an optional fifth argument and must clear all of them too, not just other labels.
test("placeRoomLabel jumps clear of a room circle its default spot would land inside", () => {
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  // A big circle centred near the label's default spot -- the label (40x16 box at baseY=-50,
  // centred x=100) starts squarely inside it.
  const bigCircle = { x: 90, y: 0, r: 80 };
  const y = placeRoomLabel(100, -50, 40, 16, placed, [bigCircle]);
  const box = { x: 80, y: y - 16, w: 40, h: 16 };
  const nearX = Math.max(box.x, Math.min(bigCircle.x, box.x + box.w));
  const nearY = Math.max(box.y, Math.min(bigCircle.y, box.y + box.h));
  const dx = bigCircle.x - nearX, dy = bigCircle.y - nearY;
  expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(bigCircle.r * bigCircle.r);
});

test("placeRoomLabel leaves a label that already clears every circle untouched", () => {
  const farCircle = { x: 900, y: 900, r: 10 };
  const y = placeRoomLabel(100, -50, 40, 16, [], [farCircle]);
  expect(y).toBe(-50);
});

// Reproduces Task 10's defect at the level draw() actually operates: two single-card rooms whose
// circles are forced to the exact same starting point, so their DEFAULT top-centre label boxes
// are identical and would stamp one over the other under the old (baseY-only) code -- exactly
// what the 1440x900 whole-deck screenshot showed for LANDS over INTERACTION.
//
// The forcing trick: render once with a lone "anchor" card so its settled position lands in
// prevPositionsRef (GraphView.tsx's layout-continuity map, keyed by node id and populated on
// effect cleanup). Then rerender with a DIFFERENT graph -- the anchor node gone, but two new
// cards (different rooms: lands, interaction) each carrying an edge that names the anchor's id as
// a neighbour. seedPosition (GraphView.tsx) averages a new node over its neighbours' *previous*
// positions, and there is exactly one such neighbour for each -- so both seed to the identical
// point regardless of whatever the anchor's own (Math.random-jittered) position happened to be.
// From there the physics is a clean two-body case: same room membership would pull them back
// together (not the case here -- lands vs interaction share nothing) and repulsion between
// perfectly coincident points is exactly zero (dx=dy=0 cancels the 1/d direction term), so the
// only thing that moves them is separation()'s deterministic coincident-point branch, which parts
// them exactly (14+14+5)=33 units apart along a fixed axis. Two 14-radius circles 33 apart, each
// labelled with a 40px-wide (measureText's constant stub) box centred on its own circle.x: 33 <
// 40, so the boxes collide under the old code by construction, not by chance -- and the test
// would need editing (not flake) if COLLISION_PAD, ART_RADIUS or the stub width ever changed.
test("keeps two rooms' labels apart when their circles are forced together", () => {
  const calls = makeContextSpy();
  const anchor = { id: "card:anchor", kind: "card", label: "Anchor Card", roles: ["boardWipe"] };
  const graph1 = { nodes: [anchor], edges: [] } as unknown as typeof SAMPLE.graph;
  const report = { ...SAMPLE.report, combos: [], archetypes: [] };
  const { rerender } = render(<GraphView graph={graph1} report={report} />);

  const cardA = { id: "card:a", kind: "card", label: "Land Card", roles: ["lands"] };
  const cardB = { id: "card:b", kind: "card", label: "Removal Card", roles: ["targetedRemoval"] };
  const graph2 = {
    nodes: [cardA, cardB],
    edges: [
      { from: cardA.id, to: anchor.id, kind: "RELATED" },
      { from: cardB.id, to: anchor.id, kind: "RELATED" },
    ],
  } as unknown as typeof SAMPLE.graph;
  calls.length = 0; // only the second render's trace matters
  rerender(<GraphView graph={graph2} report={report} />);

  const fillTexts = calls.filter((c) => c.startsWith("fillText:"));
  const boxOf = (prefix: string) => {
    const call = fillTexts.find((c) => c.slice("fillText:".length).startsWith(prefix));
    expect(call).toBeDefined();
    const parts = call!.slice("fillText:".length).split(",");
    const [x, y] = parts.slice(-2).map(Number);
    // Matches draw()'s own formula: fontPx = 12/cam.z (cam.z is 1 here, no zoom applied), box
    // width is measureText's constant stub (40), height fontPx*1.35 -- same maths the production
    // code uses to decide whether two labels clash, not a value invented for this test.
    const w = 40, h = 12 * 1.35;
    return { x: x - w / 2, y: y - h, w, h };
  };
  const lands = boxOf("LANDS");
  const interaction = boxOf("INTERACTION");
  const overlap =
    lands.x < interaction.x + interaction.w && lands.x + lands.w > interaction.x &&
    lands.y < interaction.y + interaction.h && lands.y + lands.h > interaction.y;
  expect(overlap).toBe(false);
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

// `cam` used to be rebuilt at the origin every time the layout effect re-ran, and `hidden` (the
// filter-chip state) is one of that effect's deps -- so toggling a chip silently reset pan and
// zoom out from under the user. Hoisting `cam` onto a ref (camRef) fixes that as a side effect:
// the ref survives the effect tearing down and being rebuilt. Needs makeContextSpy() -- the probe
// this reads is only attached once `ctx` is real, same as every other probe-reading test above.
test("keeps pan and zoom when a filter chip is toggled", () => {
  makeContextSpy();
  const { container } = render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  const canvas = container.querySelector("canvas") as HTMLCanvasElement & {
    __graphProbe?: () => { camZ: number };
  };
  fireEvent.wheel(canvas, { deltaY: -240 });
  const before = canvas.__graphProbe!().camZ;
  // Without this, `before` and the post-toggle read are both `undefined` on a build that dropped
  // `camZ` off the probe entirely (e.g. a revert of the camRef change), and `undefined === undefined`
  // passes -- the test would catch nothing. Pin the value as a real number first.
  expect(Number.isFinite(before)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /event/i }));
  expect(canvas.__graphProbe!().camZ).toBe(before);
});

// The kind-filter row already has a "card" chip (accessible name "card <count>"), so an unanchored
// /card/i would match two buttons and getByRole would throw on ambiguity. Anchored to the mode
// button's exact label ("Card") rather than the filter chip's "card N".
test("switching to card mode raises the zoom past the card threshold", () => {
  makeContextSpy();
  const { container } = render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  fireEvent.click(screen.getByRole("button", { name: /^card$/i }));
  const canvas = container.querySelector("canvas") as HTMLCanvasElement & {
    __graphProbe?: () => { camZ: number };
  };
  expect(canvas.__graphProbe!().camZ).toBeGreaterThanOrEqual(6);
});

// The wheel handler's own ceiling used to be a bare 5, below CARD_MODE_Z (6) -- so card mode was
// unreachable by scrolling at all, and clicking "Card" then touching the wheel even once (in
// either direction) snapped cam.z straight back under the threshold. Scrolling in enough ticks
// must be able to reach card mode on its own, with no button involved.
test("scrolling in far enough reaches card mode on its own", () => {
  makeContextSpy();
  const { container } = render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  const canvas = container.querySelector("canvas") as HTMLCanvasElement & {
    __graphProbe?: () => { camZ: number };
  };
  // Each tick multiplies cam.z by 1.1 from a start of 1; 30 ticks (1.1^30 ~= 17.4) clears any
  // reasonable ceiling above CARD_MODE_Z (6) with room to spare.
  for (let i = 0; i < 30; i++) fireEvent.wheel(canvas, { deltaY: -240 });
  expect(canvas.__graphProbe!().camZ).toBeGreaterThanOrEqual(6);
});

// Task 1's presets.test.ts fixture (Malakir Rebirth // Malakir Mire, an Instant whose back face is
// a Land, plus Deathrite Shaman as a second card) with artCrop added to card:1 and to face:1:1 --
// Task 4 puts each face's own art on its face node, and this is what proves the flip actually
// swaps which art loads rather than just flipping a flag nothing reads. Declared here rather than
// imported across test files. Deathrite Shaman (card:2) matters for the layout-stability test
// below even though it plays no other part in this file: with only one visible card, the
// all-pairs repulsion/room-attraction loop in `tick()` has no second node to act on and a reheat
// is silently a no-op regardless of whether the dependency bug it's meant to catch is present.
const dfcGraph = {
  nodes: [
    {
      id: "card:1", kind: "card", label: "Malakir Rebirth // Malakir Mire", roles: ["protection"],
      copies: 1, artCrop: "https://x/front.jpg",
    },
    { id: "face:1:0", kind: "face", label: "Malakir Rebirth" },
    { id: "face:1:1", kind: "face", label: "Malakir Mire", artCrop: "https://x/back.jpg" },
    { id: "type:Instant", kind: "type", label: "Instant" },
    { id: "type:Land", kind: "type", label: "Land" },
    { id: "color:B", kind: "color", label: "B" },
    { id: "cmc:2", kind: "cmc", label: "2" },
    { id: "card:2", kind: "card", label: "Deathrite Shaman", copies: 1 },
    { id: "face:2:0", kind: "face", label: "Deathrite Shaman" },
    { id: "type:Creature", kind: "type", label: "Creature" },
    { id: "subtype:Elf", kind: "subtype", label: "Elf" },
    { id: "subtype:Shaman", kind: "subtype", label: "Shaman" },
    { id: "color:G", kind: "color", label: "G" },
    { id: "cmc:1", kind: "cmc", label: "1" },
  ],
  edges: [
    { from: "card:1", to: "face:1:0", kind: "FACE", index: 0 },
    { from: "card:1", to: "face:1:1", kind: "FACE", index: 1 },
    { from: "face:1:0", to: "type:Instant", kind: "TYPE" },
    { from: "face:1:1", to: "type:Land", kind: "TYPE" },
    { from: "card:1", to: "color:B", kind: "IDENTITY" },
    { from: "card:1", to: "cmc:2", kind: "CMC" },
    { from: "card:2", to: "face:2:0", kind: "FACE", index: 0 },
    { from: "face:2:0", to: "type:Creature", kind: "TYPE" },
    { from: "face:2:0", to: "subtype:Elf", kind: "SUBTYPE" },
    { from: "face:2:0", to: "subtype:Shaman", kind: "SUBTYPE" },
    { from: "card:2", to: "color:B", kind: "IDENTITY" },
    { from: "card:2", to: "color:G", kind: "IDENTITY" },
    { from: "card:2", to: "cmc:1", kind: "CMC" },
  ],
} as unknown as typeof SAMPLE.graph;

// The literal test in the task-7 brief dispatches its clicks at a fixed (100, 100) and selects the
// "Card" mode button with an unanchored /card/i, which also matches the kind-filter row's own
// "card 2" chip (two nodes of kind "card" in this fixture) -- ambiguous, per the anchoring already
// used above for the same button (see "switching to card mode..."). And a hardcoded click point
// assumes the DFC node settles exactly there, which is exactly the prediction the "hover shows a
// card's build role" test above found didn't hold for the simulated layout -- __graphProbe's exact
// x/y is the only thing to click through, same as that test does. `pick()`'s hit test divides
// screen coordinates by `cam.z` (jsdom's canvas has a zero bounding rect, so no other term in that
// division is nonzero here), so the click point is the probed world position scaled by the camera
// zoom the "Card" button just set -- multiplying by anything else lands off the node's disc.
it("flips a double-faced card to its back art and back again", () => {
  makeContextSpy();
  const { container } = render(<GraphView graph={dfcGraph} report={SAMPLE.report} />);
  const canvas = container.querySelector("canvas") as HTMLCanvasElement & {
    __graphProbe?: () => Array<{ id: string; x: number; y: number }> & {
      camZ: number;
      flipped: string[];
    };
  };
  fireEvent.click(screen.getByRole("button", { name: /^card$/i }));
  const probe = canvas.__graphProbe!();
  const node = probe.find((n) => n.id === "card:1")!;
  const at = { clientX: node.x * probe.camZ, clientY: node.y * probe.camZ };
  fireEvent.click(canvas, at); // the DFC's node
  expect(canvas.__graphProbe!().flipped).toEqual(["card:1"]);
  fireEvent.click(canvas, at);
  expect(canvas.__graphProbe!().flipped).toEqual([]);
});

// Flip is PICTURE ONLY (the task's one hard rule): it must not move a single node. `flipped` used
// to sit in the layout effect's own dependency array, so a flip click tore the whole effect down
// and rebuilt it -- cancelling and restarting the RAF loop, tearing down and re-adding every
// pointer/wheel/click listener, and re-running one simulation tick at a partial reheat (alpha 0.3)
// against forces computed from the current positions. Positions survive via `prevPositions`, but
// that one extra tick still nudges them by a nonzero (if small) amount -- which is exactly what
// "flip moved the board" means. Asserts every node's x/y, not just the flipped card's, since a
// reheat disturbs the whole simulation (room attraction, repulsion, link springs all read every
// node), not only the one that got clicked.
test("defaults to the role preset", () => {
  render(<GraphView graph={SAMPLE.graph} report={SAMPLE.report} />);
  expect(screen.getByRole("combobox", { name: /group by/i })).toHaveValue("role");
});

// dfcGraph carries TWO cards (see its own doc comment above): Malakir Rebirth // Malakir Mire
// (B, front face Instant) and Deathrite Shaman (B/G, Creature). Both are real, so the derived
// "colour" preset genuinely produces two rooms here (B from both cards, G from Deathrite Shaman
// alone) -- not the single-room result a smaller fixture might suggest. Ordered by member count,
// descending (presets.ts's `byCount`): B has two members, G has one, so B sorts first regardless.
// makeContextSpy() is required (the brief's sketch omitted it, same as every other probe-reading
// test in this file) -- without a real 2D context the layout effect bails before `__graphProbe`
// is ever attached, and `.rooms` would fail on "not a function" rather than on the assertion this
// test is actually about.
it("regroups the board when the preset changes", () => {
  makeContextSpy();
  const { container } = render(<GraphView graph={dfcGraph} report={SAMPLE.report} />);
  fireEvent.change(screen.getByRole("combobox", { name: /group by/i }), { target: { value: "colour" } });
  expect((container.querySelector("canvas") as any).__graphProbe!().rooms).toEqual(["B", "G"]);
});

// The central test for this task: proves the "type" preset reads a face's TYPE off the FRONT
// face only, end to end through the real component (Task 1's cardFacts already unit-tests this
// in isolation -- presets.test.ts -- but nothing before this task exercised it through GraphView's
// actual wiring). Deathrite Shaman (card:2, Creature) is also in this graph, so the derived room
// list is genuinely two rooms wide; a wiring bug that fed a DFC's BACK face's type in too (Land,
// from face:1:1) would show up as a THIRD room here, and one that dropped the front-face
// restriction entirely and read every face's types unfiltered would too. "Creature" sorts before
// "Instant" on the count tie-break (presets.ts's `byCount`, alphabetical), so this is the order a
// correct implementation actually produces, not an arbitrary pick.
it("groups a double-faced card by its FRONT face", () => {
  makeContextSpy();
  const { container } = render(<GraphView graph={dfcGraph} report={SAMPLE.report} />);
  fireEvent.change(screen.getByRole("combobox", { name: /group by/i }), { target: { value: "type" } });
  expect((container.querySelector("canvas") as any).__graphProbe!().rooms).toEqual(["Creature", "Instant"]);
});

it("does not move any node when a card is flipped", () => {
  makeContextSpy();
  const { container } = render(<GraphView graph={dfcGraph} report={SAMPLE.report} />);
  const canvas = container.querySelector("canvas") as HTMLCanvasElement & {
    __graphProbe?: () => Array<{ id: string; x: number; y: number }> & {
      camZ: number;
      flipped: string[];
    };
  };
  fireEvent.click(screen.getByRole("button", { name: /^card$/i }));
  const before = canvas.__graphProbe!();
  const node = before.find((n) => n.id === "card:1")!;
  const positionsBefore = before.map((n) => ({ id: n.id, x: n.x, y: n.y }));
  fireEvent.click(canvas, { clientX: node.x * before.camZ, clientY: node.y * before.camZ });
  const after = canvas.__graphProbe!();
  // Sanity check the click actually flipped something -- otherwise "positions unchanged" would be
  // true for the trivial reason that nothing happened at all.
  expect(after.flipped).toEqual(["card:1"]);
  expect(after.map((n) => ({ id: n.id, x: n.x, y: n.y }))).toEqual(positionsBefore);
});
