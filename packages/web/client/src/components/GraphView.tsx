import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type D3ZoomEvent } from "d3-zoom";
import type { CardGraph, DeckReport, GraphNode, NodeKind } from "../types.js";
import { createArtLoader, type ArtLoader } from "./art-loader.js";
import { cachedImageLoad } from "./art-cache.js";
import { glyphFor } from "./graph-glyphs.js";
import { CARD_MODE_Z, MAX_Z, cardImageUrl, faceArtOf, renderModeFor } from "./card-node.js";
import { ART_RADIUS, rimArcs, rimHues, OVERFLOW_HUE, ROOMS, roomLayout, roomTallies, subcategoryLabel, type Circle, type RoomId } from "./deck-rooms.js";
// Re-exported so this module stays the import site every consumer (and GraphView.test.tsx) already
// uses, while deck-rooms.ts owns the value -- see its doc comment for why it moved.
export { ART_RADIUS };
import { cardFacts, PRESETS, roomsForFacts } from "./presets.js";
import {
  createBoardSimulation, DEFAULT_PARAMS, nodeRadius, projectRoomMembership, universalRooms,
  type BoardParams, type Sim,
} from "./board-force.js";
import { BoardTuner, type ProbeSnapshot } from "./BoardTuner.js";
// Re-exported so this module stays the import site every consumer (and GraphView.test.tsx)
// already uses, while board-force.ts owns the simulation-side values -- same arrangement
// deck-rooms.ts already has for ART_RADIUS above.
export {
  boardMetrics, containment, foreignPush, nodeRadius, roomAttraction,
  UNIVERSAL_ROOM_FRACTION, universalRooms,
} from "./board-force.js";
export type { Sim } from "./board-force.js";

/** Kinds ordered for the filter row: the ones worth looking at first. */
const KIND_ORDER: NodeKind[] = [
  "event", "card", "subtype", "keyword", "token", "related",
  "type", "supertype", "power", "toughness", "face", "color", "mana", "cmc", "layout",
];

/** Every kind but "card" is hidden on first paint. Phase 1 of the deck board is about reading the
 *  deck: two independent blind judges, given no checklist, both named the blue event glyphs as the
 *  first thing that draws the eye, and neither the concept mesh nor the edges answered "which of
 *  these is my removal". The old narrower default (just the eight characteristic kinds: layout,
 *  cmc, mana, color, type, supertype, power, toughness) still left ~200 event/subtype/keyword/etc.
 *  nodes on by default, competing with the ~94 cards for attention -- this widens it to all of
 *  them. Nothing is removed: every kind keeps its filter chip and is one click from coming back;
 *  phase 2 is the separate question of how relationships get drawn on a board rather than in a
 *  free layout. Derived from KIND_ORDER (every kind but "card") rather than hand-listed, so a kind
 *  added there later can't be silently forgotten here. */
export const DIM_BY_DEFAULT: NodeKind[] = KIND_ORDER.filter((k) => k !== "card");

const TAU = Math.PI * 2;
/** Glyphs are authored in a 24x24 box (see graph-glyphs.ts); half that is the box's own centre. */
const GLYPH_BOX_HALF = 12;

/** World units the flip glyph is pulled in from the card box's bottom-right corner. It used to be
 *  painted AT the corner (n.x + ART_RADIUS, n.y + ART_RADIUS * 1.4) -- exactly the boundary
 *  pick()'s rectangular hit test accepts, so a genuine click on the glyph's own anchor point was a
 *  coin flip against float rounding in the screen<->world round-trip. Inset it so the anchor sits
 *  strictly inside the hit box; the glyph still reads as "corner of the card" at card zoom. */
export const FLIP_GLYPH_INSET = 4;

/** Height, in world units, of a room-hue bar along a card-mode card's bottom edge. The card-mode
 *  answer to a rim arc: a 5:7 rectangle has no rim to stroke arcs onto. */
const BAR_H = 3;

/** Rows visible in the DOM room legend before it scrolls -- the ONE literal both the CSS
 *  `calc(${LEGEND_VISIBLE_ROWS} * var(--legend-row-h))` cap and the pointer-events threshold below
 *  it read, so they can't drift into two different row counts the way `max-h-[19.5rem]` and
 *  `h-[1.625rem]` once did. */
const LEGEND_VISIBLE_ROWS = 12;

type Point = { x: number; y: number };

/** Screen pixels of camera translation between a zoom gesture's start and its end, below which the
 *  gesture still counts as a click rather than a pan. Not zero: real hardware never reports an
 *  intended click as exactly stationary -- and on a trackpad, essentially no click is. */
const CLICK_DRAG_PX = 4;

/** Whether a zoom gesture's start and end transforms differ enough to have been a pan rather than
 *  a click -- the same question `traveledAsDrag` answered from raw pointer deltas (Task 6 deleted
 *  it when the DOM `click` listener it fed was still the call site), asked of two transforms
 *  instead now that the call site is `zoomBehavior`'s own `"end"` event (fix round 2, see the
 *  doc comment at that call site for why `click` itself had to go). Pulled out as its own pure
 *  function for the same reason `traveledAsDrag` was: this jsdom cannot construct a real
 *  mousedown-driven zoom gesture at all (see GraphView.test.tsx), so the arithmetic is what's
 *  unit-testable, not the gesture that produces its inputs. A scale change alone (`end.k !==
 *  start.k`) counts as a pan even with zero translation -- a click can't zoom the camera, so any
 *  "click" reporting a different scale from where the gesture started did not, in fact, just click. */
export function traveledAsPan(
  start: { x: number; y: number; k: number },
  end: { x: number; y: number; k: number },
  threshold = CLICK_DRAG_PX,
): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) > threshold || end.k !== start.k;
}

/** Card name -> copy count, built from the graph's own card nodes (each copy of a card already
 *  collapses into one node, keyed by id, with the count riding on `copies`). Absent `copies`
 *  means one copy. Exists as its own pure, testable function rather than inlined at its one call
 *  site because roomTallies' copiesByName is *optional* -- the easy mistake is a caller that
 *  builds `cardRooms` correctly but forgets this map entirely, which roomTallies accepts
 *  silently and tallies wrong (see the doc comment at this function's call site). */
export function copiesByNameOf(nodes: readonly GraphNode[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of nodes) {
    if (n.kind !== "card") continue;
    out.set(n.label, n.copies ?? 1);
  }
  return out;
}

/** Which room circles a world-space point falls inside. Plural on purpose: overlapping circles are
 *  the normal case, and a card in two rooms sits in the lens where both contain it. */
export function roomsUnder(
  wx: number, wy: number, circles: ReadonlyMap<string, Circle>,
): string[] {
  const out: string[] = [];
  for (const [id, c] of circles) {
    if (Math.hypot(wx - c.x, wy - c.y) <= c.r) out.push(id);
  }
  return out;
}

/** Where a node that's new since the last render should start: the centroid of whichever of its
 *  neighbours already had a position (from the previous layout), so it visibly joins the cluster
 *  it connects to rather than dropping in at an arbitrary spot. Falls back to `fallback` when none
 *  of its neighbours are known yet (e.g. two brand-new nodes linked only to each other). */
export function seedPosition(neighborIds: string[], prevPositions: Map<string, Point>, fallback: Point): Point {
  let sx = 0, sy = 0, count = 0;
  for (const id of neighborIds) {
    const p = prevPositions.get(id);
    if (!p) continue;
    sx += p.x; sy += p.y; count++;
  }
  return count > 0 ? { x: sx / count, y: sy / count } : fallback;
}

export function GraphView({ graph, report }: { graph: CardGraph; report: DeckReport }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<Set<NodeKind>>(() => new Set(DIM_BY_DEFAULT));
  const [hover, setHover] = useState<
    { label: string; kind: string; deg: number; detail: string; x: number; y: number } | null
  >(null);
  // Which rooms the pointer is inside, highlighted in the legend. Written on pointermove like
  // `hover` already is, and deliberately absent from the layout effect's dependency array for the
  // same reason -- it must not reheat the simulation.
  const [hoveredRooms, setHoveredRooms] = useState<readonly string[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [query, setQuery] = useState("");
  // Sticky per-card flip state (picture only -- see card-node.ts's faceArtOf doc comment). A card
  // id in this set draws its back face's art instead of its front.
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set());
  // Which predicate groups the board (Task 8). Defaults to "role" so an unmodified board looks
  // exactly like it always has -- the other four (type, colour, mana value, subtype) are derived
  // from the deck itself, see presets.ts.
  const [presetId, setPresetId] = useState("role");
  // Capability check rather than a user-agent sniff: iOS Safari on iPhone has no element
  // fullscreen, and a button that silently does nothing is worse than no button.
  const canFullscreen = typeof Element !== "undefined" && "requestFullscreen" in Element.prototype;
  // Developer instruments (the 16 node-kind filter chips, the render-mode buttons) behind one
  // toggle. Local state on purpose -- it does not persist across mounts, per the spec.
  const [debug, setDebug] = useState(false);
  // Dev tuning rig (BoardTuner). DEFAULT_PARAMS is the shipped board -- nothing but the panel
  // ever changes these, and the panel only exists under import.meta.env.DEV.
  const [params, setParams] = useState<BoardParams>(DEFAULT_PARAMS);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void shellRef.current?.requestFullscreen().catch(() => {});
  };

  // Layout continuity (Step 0): positions of every node as of the last time this effect tore
  // down, keyed by id. Persists across `graph`/`hidden` changes for the life of this component so
  // a re-render moves only what actually changed instead of re-throwing the whole layout.
  // ponytail: never pruned of ids that drop out of the graph, so it grows unbounded for the life
  // of a mounted GraphView. Fine at one deck's worth of nodes per mount; add pruning on teardown
  // (drop ids not in the latest `graph.nodes`) if this component ever stays mounted across many
  // distinct decks in one session.
  const prevPositionsRef = useRef<Map<string, Sim>>(undefined);
  prevPositionsRef.current ??= new Map();
  // Lazily-built Path2D cache for glyphs (Step 4). Built at stroke time, never at module load --
  // Path2D has no jsdom polyfill, see graph-glyphs.ts's doc comment.
  const pathCacheRef = useRef<Map<string, Path2D>>(undefined);
  pathCacheRef.current ??= new Map();
  // Concurrency-capped, spaced, retrying art loader (Step 3 / see art-loader.ts), created once
  // per mount so state (and in-flight requests) survive a graph/filter change re-running the effect.
  // `load` reads through the Cache API first (see art-cache.ts) so art already seen renders with
  // the network gone -- offline survival, not a speed change (HTTP caching already covered reload).
  const artLoaderRef = useRef<ArtLoader>(undefined);
  artLoaderRef.current ??= createArtLoader({ load: cachedImageLoad() });
  // Effect-local until now, which is why toggling a chip reset the view: `hidden` is a dep, so the
  // effect re-ran and rebuilt the camera at the origin. A ref survives that, and the mode control
  // below needs to write z from outside the effect anyway.
  const camRef = useRef({ x: 0, y: 0, z: 1 });
  // The Card/Miniature debug buttons jump the zoom level with no real pointer gesture behind it.
  // They used to write camRef.current.z directly, which left d3-zoom's own bookkeeping (the
  // canvas's `__zoom`) stale -- the FIRST real click afterward reads that stale transform as the
  // baseline a genuine mousedown snapshots, sees it disagree with the jumped `cam.z`, and the click
  // guard below (Task 6) swallows it as a false drag. Written by the layout effect once its
  // zoomBehavior exists; the buttons render before that effect runs and must survive it re-running
  // (a filter or preset change) without going stale, hence a ref rather than a plain closure.
  const jumpZoomRef = useRef<(z: number) => void>(() => {});

  const counts = useMemo(() => {
    const c = new Map<NodeKind, number>();
    for (const n of graph.nodes) c.set(n.kind, (c.get(n.kind) ?? 0) + 1);
    return c;
  }, [graph]);

  // Face node id -> its art (Task 4 put artCrop on each face). Built once per graph rather than
  // scanned in the paint loop, which runs every frame.
  const faceArt = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of graph.nodes) if (n.kind === "face" && n.artCrop) m.set(n.id, n.artCrop);
    return m;
  }, [graph]);

  /** Card node ids matching the current search, or null when the box is empty. Null and "the
   *  empty set" mean different things to the draw pass: null dims nothing, an empty set (a query
   *  that hits zero cards) dims everything. */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const hit = new Set<string>();
    for (const n of graph.nodes) {
      if (n.kind === "card" && n.label.toLowerCase().includes(q)) hit.add(n.id);
    }
    return hit;
  }, [graph, query]);

  // The layout effect's draw() reads this through a ref rather than closing over `matches`
  // directly, and `matches` is deliberately absent from that effect's dependency array below --
  // the effect owns the force simulation, and adding `matches` there would reheat and re-seed the
  // whole layout on every keystroke, moving the board under the user while they type.
  const matchesRef = useRef<Set<string> | null>(null);
  matchesRef.current = matches;

  // Same reasoning as matchesRef, for the same reason: `flipped` is deliberately absent from the
  // layout effect's deps below. Flip is PICTURE ONLY -- adding it there would tear down and rebuild
  // the whole force simulation (RAF loop, listeners, `nodes`) on every flip click, a partial reheat
  // that visibly resettles the board. draw() and the probe read this ref instead.
  const flippedRef = useRef<Set<string>>(new Set());
  flippedRef.current = flipped;

  /** One fact record per card. Combo membership (report.combos[].cards) is folded in here rather
   *  than left for the role preset to rediscover -- this is the same set the pre-Task-8 code built
   *  inline before calling roomsForCard directly; cardFacts just carries it as a fact now instead
   *  of it living only in a closure. Memoised on `graph` AND `report` -- switching the preset chip
   *  alone still skips this (React bails when neither dep changed), but a report refresh
   *  (a new combos list on the same graph) must not be missed. */
  const facts = useMemo(() => {
    const comboCards = new Set((report.combos ?? []).flatMap((c) => c.cards));
    return cardFacts(graph, comboCards);
  }, [graph, report]);
  // PRESETS is a fixed module-level array, so `.find` returns the SAME object reference for a
  // given id across renders -- `rooms` below can memoise on `preset` itself, not presetId.
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  /** The current preset's room list: fixed for "role" (today's seven), derived and ordered by
   *  member count for the other four -- see presets.ts. */
  const rooms = useMemo(() => preset.rooms(facts), [preset, facts]);
  /** Which rooms each card node belongs to, keyed by node id. For the role preset this
   *  reproduces the same map the old `roomsForCard` call built (it delegates to that same
   *  function -- see presets.ts), which is what keeps every pre-Task-8 test green untouched. */
  const roomsByNode = useMemo(
    () => new Map(facts.map((f) => [f.id, roomsForFacts(rooms, f)])),
    [rooms, facts],
  );
  /** Room id -> hue, off the CURRENT preset rather than deck-rooms.ts's ROOM_HUE (which only
   *  knows the seven role ids and would silently paint `undefined` for a colour/type/mana-value/
   *  subtype id -- the defect Task 2 carried forward). Every hue lookup in the draw pass below
   *  reads this map, falling back to OVERFLOW_HUE. */
  const hueOf = useMemo(() => new Map(rooms.map((r) => [r.id, r.hue])), [rooms]);

  /** Room counts/targets for Task 5's board chrome. Passing `copiesByNameOf(graph.nodes)` is
   *  load-bearing, not optional decoration: roomTallies' copiesByName parameter is optional with
   *  a `?? 1` fallback precisely so a caller that forgets to pass it still runs -- just wrong,
   *  tallying a 36-Mountain deck's Lands room as 1/36. */
  const tallies = useMemo(() => {
    const cardRooms = new Map<string, readonly RoomId[]>();
    for (const n of graph.nodes) {
      if (n.kind !== "card") continue;
      cardRooms.set(n.label, roomsByNode.get(n.id) ?? []);
    }
    return roomTallies(
      cardRooms,
      rooms.map((r) => ({ id: r.id, categories: r.categories ?? [] })),
      report.buildCategories,
      copiesByNameOf(graph.nodes),
    );
  }, [graph, report, roomsByNode, rooms]);

  /** Event rows for the table: emitters in, payoffs out. */
  const events = useMemo(() => {
    const emit = new Map<string, number>();
    const pay = new Map<string, number>();
    for (const e of graph.edges) {
      if (e.kind === "EMITS") emit.set(e.to, (emit.get(e.to) ?? 0) + 1);
      if (e.kind === "TRIGGERS") pay.set(e.from, (pay.get(e.from) ?? 0) + 1);
    }
    return graph.nodes
      .filter((n) => n.kind === "event")
      .map((n) => ({ key: n.label, emitters: emit.get(n.id) ?? 0, payoffs: pay.get(n.id) ?? 0 }))
      .sort((a, b) => b.emitters + b.payoffs - (a.emitters + a.payoffs));
  }, [graph]);

  /** Legend (Step 5): one entry per distinct event tag actually present in this graph, keyed the
   *  same way `glyphFor` resolves them, so it never lists a glyph the graph doesn't use. */
  const legend = useMemo(() => {
    const seen = new Map<string, string>();
    for (const n of graph.nodes) {
      if (n.kind !== "event") continue;
      const tag = n.id.startsWith("event:") ? n.id.slice("event:".length) : n.id;
      const [prefix, second] = tag.split(":");
      const key = prefix === "static" ? (second ?? "") : (prefix ?? "");
      if (key && !seen.has(key)) seen.set(key, glyphFor(n));
    }
    return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [graph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const css = getComputedStyle(canvas);
    const paint = {
      accent: css.getPropertyValue("--accent").trim() || "#5b8dee",
      fg: css.getPropertyValue("--foreground").trim() || "#e6e8eb",
      muted: css.getPropertyValue("--muted").trim() || "#8b93a1",
      sep: css.getPropertyValue("--separator").trim() || "#1d2126",
      border: css.getPropertyValue("--border").trim() || "#262b31",
      surface: css.getPropertyValue("--surface").trim() || "#14171b",
      warning: css.getPropertyValue("--warning").trim() || "#d99a3d",
    };
    /** Near-monochrome with one accent, matching the system's Restrained strategy: the event nodes
     *  are the point of this view and take the accent; cards read as foreground; everything a card
     *  merely HAS recedes to muted. A per-kind rainbow would be a second color system. */
    const colorOf = (k: NodeKind): string =>
      k === "event" ? paint.accent : k === "card" ? paint.fg : paint.muted;

    const size = () => {
      const dpr = devicePixelRatio;
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      return { w: r.width, h: r.height, dpr };
    };
    let dim = size();

    const prevPositions = prevPositionsRef.current!;
    const isFirstLayout = prevPositions.size === 0;

    // Neighbour lookup built from the raw edge list, before Sim objects exist -- only needed to
    // seed a brand-new node near what it connects to (Step 0).
    const neighborsOf = new Map<string, string[]>();
    for (const e of graph.edges) {
      (neighborsOf.get(e.from) ?? neighborsOf.set(e.from, []).get(e.from)!).push(e.to);
      (neighborsOf.get(e.to) ?? neighborsOf.set(e.to, []).get(e.to)!).push(e.from);
    }

    const nodes: Sim[] = graph.nodes.map((n, i) => {
      const prev = prevPositions.get(n.id);
      if (prev) return { ...n, x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy, deg: 0 };
      const seed = seedPosition(neighborsOf.get(n.id) ?? [], prevPositions, {
        x: Math.cos(i) * 260 + Math.random() * 30,
        y: Math.sin(i) * 260 + Math.random() * 30,
      });
      return { ...n, x: seed.x, y: seed.y, vx: 0, vy: 0, deg: 0 };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    // `{ source, target }` is what forceLink requires, so it is what the whole effect uses.
    const links = graph.edges
      .map((e) => ({ source: byId.get(e.from), target: byId.get(e.to) }))
      .filter((l): l is { source: Sim; target: Sim } => Boolean(l.source && l.target));
    for (const l of links) { l.source.deg++; l.target.deg++; }

    const visible = (n: Sim) => !hidden.has(n.kind);

    // Computed once per effect run, not per tick: `hidden` is already a dependency of this effect,
    // so a visibility change re-runs it and this set is rebuilt with it.
    const universal = universalRooms(
      rooms.map((r) => r.id),
      nodes.filter((n) => n.kind === "card" && visible(n)).map((n) => roomsByNode.get(n.id) ?? []),
    );

    // Every node is bound to the simulation, visible or not (project owner's ruling, 7585fca) --
    // see createBoardSimulation's doc comment for the measurements. `visible` is a paint,
    // hit-test and room-circle concern only.
    const { simulation, roomCircles: roomCirclesNow } = createBoardSimulation({
      nodes, links, roomsByNode, rooms, tallies, universal, visible, params,
    });
    // A from-scratch graph gets full energy to organize; a graph that already has settled
    // positions (a filter toggle, or -- once deckbuilding lands -- a card added/removed) only
    // needs enough to let what changed find its place. See Step 0 / the deck-view-mode stub.
    simulation.alpha(isFirstLayout ? 1 : 0.3);

    // Written by the rAF loop below, read by __graphProbe. A plain `let` rather than a ref: it is
    // scoped to one run of this effect, so a re-run (preset change, filter toggle) starts from a
    // fresh 0 instead of reporting the previous board's leftovers until the first tick lands.
    let unresolved = 0;

    // Measurement hook for the readability judge (and for anyone debugging layout in a console):
    // the live simulation state, which is otherwise sealed inside this closure. Read-only snapshot,
    // rebuilt per call. Not dev-gated -- it is a few bytes, it ships no behaviour, and a metric you
    // can only collect in a special build is a metric nobody collects.
    //
    // `tallies` rides along as a property on the returned array (not a change to the array's own
    // shape) rather than wrapping the return value in `{ nodes, tallies }`: Task 8's plan already
    // documents `__graphProbe()` returning the node array directly
    // (`const cards = nodes.filter(...)`), and this is otherwise a dead value with no test able to
    // reach the real `tallies` useMemo at all -- reachable now without breaking that contract.
    (canvas as unknown as { __graphProbe?: () => unknown }).__graphProbe = () =>
      Object.assign(
        nodes.filter(visible).map((n) => ({
          id: n.id, kind: n.kind, x: n.x, y: n.y, r: nodeRadius(n),
          roles: n.roles ?? null, artCrop: n.artCrop ?? null,
          rooms: n.kind === "card" ? (roomsByNode.get(n.id) ?? []) : null,
        })),
        // camRef.current, read directly rather than through `cam` below: the mode buttons write
        // camRef.current.z from outside this effect, and this closure must see that write on its
        // next call rather than a value frozen when the probe was first built.
        //
        // `rooms` here is the CURRENT preset's own room-id list (Task 8), not a per-node value --
        // sibling to `tallies`/`camZ`/`flipped` above, not to the per-node `rooms` field each
        // element of the mapped array already carries.
        //
        // `circles` rides along the same way `tallies` does -- a property on the returned array,
        // not a change to its shape. Without it the escape and intrusion metrics cannot be
        // computed at all: the probe knows where every card is and which rooms it is in, but not
        // where the rooms are.
        {
          tallies, camZ: camRef.current.z, flipped: [...flippedRef.current],
          rooms: rooms.map((r) => r.id),
          circles: [...roomCirclesNow().entries()].map(([id, c]) => ({ id, x: c.x, y: c.y, r: c.r })),
          // `unresolved` rides along the same way `circles` and `tallies` do. Zero intrusions or
          // the board says so -- without this the panel cannot tell a genuinely legal board from
          // one the projection gave up on, and both look identical in every other metric.
          unresolved,
          // Exposes the REAL `toWorld` closure (declared further down this effect -- fine, this
          // outer function isn't invoked until well after the whole effect body has run) rather
          // than a reimplementation, so a test exercises the exact screen<->world math the pointer
          // handlers use, not a copy that could drift from it. Round-1 fix verification needs this:
          // the defect (draw()'s canvas-centre origin vs d3-zoom's top-left one) was invisible to
          // every prior test because nothing could ask "what world point is under this client
          // point" without either reading real canvas pixels or reaching this function directly.
          toWorld,
          // Test-only entry into the ACTUAL gesture wiring behind zoomBehavior's "end" handler
          // below (traveledAsPan -> pick -> setFlipped) -- not a reimplementation, the exact same
          // `zoomBehavior.transform` call `jumpZoom` already makes in production, just with a 4th
          // `event` argument. d3-zoom's own `zoom.transform` attaches whatever it's given as
          // `sourceEvent` via `Gesture.prototype.event(event)` -- a plain property write, no WebIDL
          // Event construction involved -- so a literal object like `{type: "mouseup", clientX,
          // clientY}` sidesteps the jsdom `view` brand check that blocks a real mousedown-driven
          // gesture entirely (see GraphView.test.tsx). `transform` defaults to the camera's own
          // current value -- a no-op move, i.e. "this gesture did not pan" -- so a caller only has
          // to say where the pointer was and what kind of event ended the gesture.
          endGesture: (
            event: { type: string; clientX?: number; clientY?: number; changedTouches?: Array<{ clientX: number; clientY: number }> },
            transform = zoomIdentity.translate(cam.x, cam.y).scale(cam.z),
          ) => {
            // @types/d3-zoom's `.transform()` only declares 3 parameters; the real d3-zoom
            // (zoom.js) takes a 4th `event` and both `selection.call`'s generic inference and a
            // direct call reject the extra argument at the type level. Cast is for that types gap
            // only -- the runtime call is exactly `zoom.transform(collection, transform, point,
            // event)` as documented in zoom.js.
            (zoomBehavior.transform as unknown as (
              sel: typeof selection, t: typeof transform, p: null, e: unknown,
            ) => void)(selection, transform, null, event);
          },
        },
      );

    const cam = camRef.current;
    let raf = 0;

    const artLoader = artLoaderRef.current!;

    // draw() computes the room circles every frame anyway. Stash the last frame's map so the
    // pointer handler can read it instead of recomputing the geometry on every pointermove.
    let lastCircles: Map<RoomId, Circle> = new Map();

    const pathFor = (glyph: string): Path2D => {
      const cache = pathCacheRef.current!;
      let p = cache.get(glyph);
      if (!p) { p = new Path2D(glyph); cache.set(glyph, p); }
      return p;
    };

    const draw = () => {
      const circles = roomCirclesNow();
      lastCircles = circles;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = paint.surface;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // cam.x/y are d3-zoom's own translate, top-left-anchored -- the SAME convention
      // `pointer(event)` (and therefore every anchor computation d3-zoom does internally) uses.
      // This used to add dim.w/2 + dim.h/2 here to draw a centre-anchored board, which put the
      // renderer's origin at the canvas CENTRE while d3-zoom kept anchoring wheel/drag at the
      // TOP-LEFT -- the two disagreed by exactly half the canvas, so every zoom recentred a
      // quarter-viewport away from the cursor. Centring now happens once, at the initial seed
      // transform below, by baking dim.w/2 + dim.h/2 into cam.x/y themselves.
      ctx.setTransform(cam.z * dim.dpr, 0, 0, cam.z * dim.dpr, cam.x * dim.dpr, cam.y * dim.dpr);

      // The board: seven rooms, drawn behind everything and drawn even when empty -- "BOARD WIPES
      // 0/3" is the finding, so the room holds its place to show the hole. Each circle is drawn
      // around the cards inside it (see roomLayout), so where two rooms overlap, a card genuinely
      // belongs to both.
      //
      // Hue rides the outline, never the fill: a translucent fill over this surface collapses
      // toward gray (measured), so it cannot be what tells two rooms apart -- the DOM legend
      // (below the canvas) and the rim arcs on each card do that. The wash only gives the region a
      // body, and doubles in the lens where two rooms meet -- which is exactly where the cards in
      // both of them sit.
      for (const room of rooms) {
        const circle = circles.get(room.id);
        if (!circle) continue;
        // The room's OWN hue, off the current preset -- not deck-rooms.ts's ROOM_HUE, which only
        // has entries for the seven role ids (see hueOf's doc comment above). `room` here IS one
        // of that preset's own room objects, so there is nothing to look up: its hue rides along.
        const hue = room.hue;

        ctx.globalAlpha = 0.10;
        ctx.fillStyle = hue;
        ctx.beginPath(); ctx.arc(circle.x, circle.y, circle.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;

        ctx.lineWidth = 1.5 / cam.z;
        ctx.strokeStyle = hue;
        ctx.beginPath(); ctx.arc(circle.x, circle.y, circle.r, 0, TAU); ctx.stroke();

        // No label on the canvas. `roomFontPx = 12 / cam.z` scaled a label's measured box with zoom
        // while `circle.r` did not, so which labels collided -- and therefore where they got pushed
        // -- was zoom-dependent and a label's y jumped discontinuously as the user zoomed. No
        // placement heuristic fixes that, and the subtype preset puts 40-80 rooms on screen for one
        // deck, where 80 labels are hopeless regardless. The DOM legend below the canvas names them.
      }

      ctx.lineWidth = 0.7 / cam.z;
      ctx.strokeStyle = paint.sep;
      ctx.beginPath();
      for (const l of links) {
        if (!visible(l.source) || !visible(l.target)) continue;
        ctx.moveTo(l.source.x, l.source.y); ctx.lineTo(l.target.x, l.target.y);
      }
      ctx.stroke();

      // A search dims what does not match rather than hiding it, so the deck keeps its shape and
      // you can see WHERE the match sits. `matchIds` null means no active search: dim nothing.
      // Read through the ref (see matchesRef above), never `matches` directly -- this closure is
      // rebuilt only when the effect re-runs, and the effect must not re-run on every keystroke.
      const matchIds = matchesRef.current;
      for (const n of nodes) {
        if (!visible(n)) continue;
        ctx.globalAlpha = matchIds && n.kind === "card" && !matchIds.has(n.id) ? 0.15 : 1;

        if (n.kind === "card") {
          // Render is a function of the camera, not a stored mode (card-node.ts's doc comment) --
          // reading cam.z here means the scroll wheel and the mode buttons can never disagree
          // about what's on screen. Card mode's source is a DIFFERENT cache key (cardImageUrl
          // rewrites the path segment to a bigger size), so switching modes cold is a real fetch,
          // not just a bigger draw of what miniature mode already had loaded.
          const mode = renderModeFor(cam.z);
          // The card-mode box, computed here rather than inside the drawImage branch: the copies
          // stack, the room bars and the search ring all key off the same rectangle.
          const cardW = ART_RADIUS * 2, cardH = cardW * 1.4;
          const base = faceArtOf(n.id, n.artCrop, flippedRef.current.has(n.id), faceArt);
          const src = mode === "card" && base ? cardImageUrl(base) : base;
          const img = src ? artLoader.get(src) : undefined;
          // Scryfall's art_crop is landscape (~626x457, ~1.37:1); the 5-arg drawImage would
          // squash it into this square node. Cover-fit instead: crop a centred square out of the
          // source (the shorter side) and draw that square into the node -- same trick as CSS
          // `object-fit: cover`. Guard the source dims: a truthy naturalWidth/Height of 0 (or NaN)
          // would make Math.min pick that and hand drawImage a zero-size source rect, which throws
          // and would otherwise kill the whole animation loop.
          // A node stands for every copy of its card. Draw the stack behind the art so nine
          // Relentless Rats do not read as one Rat, and badge the count -- the room tallies are
          // in copies, so the number on the node is what makes the room's number add up.
          const copies = n.copies ?? 1;
          if (copies > 1) {
            ctx.strokeStyle = paint.border;
            ctx.lineWidth = 1 / cam.z;
            for (const offset of [4, 2]) {
              if (mode === "card") {
                ctx.strokeRect(n.x - cardW / 2 + offset, n.y - cardH / 2 - offset, cardW, cardH);
              } else {
                ctx.beginPath();
                ctx.arc(n.x + offset, n.y - offset, ART_RADIUS, 0, TAU);
                ctx.stroke();
              }
            }
          }

          if (mode === "card" && img instanceof HTMLImageElement && img.naturalWidth > 0) {
            // The full card, not a cover-fit crop: a 5:7 box centred on the node. 40% taller than
            // the miniature's disc (28 * 1.4 = 39.2 world units) -- fine, and deliberately NOT
            // re-laid-out for: card mode only happens zoomed in, where neighbours are hundreds of
            // screen px apart (see card-node.ts's CARD_MODE_Z doc comment for the threshold math).
            ctx.drawImage(img, n.x - cardW / 2, n.y - cardH / 2, cardW, cardH);
          } else if (img instanceof HTMLImageElement && img.naturalWidth > 0 && img.naturalHeight > 0) {
            const sw = img.naturalWidth, sh = img.naturalHeight, s = Math.min(sw, sh);
            ctx.save();
            ctx.beginPath(); ctx.arc(n.x, n.y, ART_RADIUS, 0, TAU); ctx.clip();
            ctx.drawImage(img, (sw - s) / 2, (sh - s) / 2, s, s,
              n.x - ART_RADIUS, n.y - ART_RADIUS, ART_RADIUS * 2, ART_RADIUS * 2);
            ctx.restore();
          } else {
            // Covers both "no art at all" and "card mode wants an image that hasn't loaded yet" --
            // a blank node is worse than a small one, so this always requests `src` (whichever size
            // the current mode wants) and draws a placeholder rather than nothing. The shape follows
            // the mode -- the miniature's filled disc, or a filled cardW/cardH rect in card mode --
            // and the FILL is the point, not incidental: this is the only thing on screen at the
            // moment the user is zoomed in and looking at nothing else, so it has to read as a solid
            // loading signal, the same fill the image itself will occupy once it lands. Do not
            // "tidy" this back to a stroke to make a test's fillRect count smaller -- that was tried
            // (fix round 1) and rejected: rendering follows the mode, not the test's bookkeeping.
            if (src) artLoader.request(src);
            ctx.fillStyle = colorOf(n.kind);
            if (mode === "card") {
              ctx.fillRect(n.x - cardW / 2, n.y - cardH / 2, cardW, cardH);
            } else {
              ctx.beginPath(); ctx.arc(n.x, n.y, nodeRadius(n), 0, TAU); ctx.fill();
            }
          }

          // The flip affordance: only at card scale, where there is room for a legible glyph -- a
          // 14-world-unit miniature disc has none -- and only when a back face exists (a
          // single-faced card has no `face:<id>:1` entry). `mode === "card"` gated FIRST so a
          // miniature-mode card never pays the replace+lookup below at all. Picture only, drawn
          // over the art itself.
          if (mode === "card" && faceArt.has(`${n.id.replace(/^card:/, "face:")}:1`)) {
            ctx.fillStyle = paint.fg;
            ctx.font = `500 ${9 / cam.z}px "JetBrains Mono", ui-monospace, monospace`;
            ctx.textAlign = "right";
            ctx.fillText("⤢", n.x + ART_RADIUS - FLIP_GLYPH_INSET, n.y + ART_RADIUS * 1.4 - FLIP_GLYPH_INSET);
          }

          // Which rooms this card is in. `hueOf` is the CURRENT preset's own id->hue map (see its
          // doc comment above), not deck-rooms.ts's ROOM_HUE -- a colour or type id would silently
          // look up `undefined` there. Drawn for both the art and the fallback branch: a card whose
          // art failed to load must not lose its membership signal along with its picture.
          const hues = rimHues((roomsByNode.get(n.id) ?? []).map((id) => hueOf.get(id) ?? OVERFLOW_HUE));
          if (mode === "card") {
            // Equal-width bars along the card's bottom edge. Card mode paints a rectangle, so
            // there is no rim to stroke arcs onto -- the arcs used to be stroked over the picture
            // at ART_RADIUS regardless, which is the defect.
            const barW = cardW / Math.max(hues.length, 1);
            hues.forEach((hue, i) => {
              ctx.fillStyle = hue;
              ctx.fillRect(n.x - cardW / 2 + i * barW, n.y + cardH / 2 - BAR_H, barW, BAR_H);
            });
            if (hues.length === 0) {
              ctx.lineWidth = 1 / cam.z;
              ctx.strokeStyle = paint.border;
              ctx.strokeRect(n.x - cardW / 2, n.y - cardH / 2, cardW, cardH);
            }
          } else {
            ctx.lineWidth = 2.5 / cam.z;
            for (const arc of rimArcs(hues)) {
              ctx.strokeStyle = arc.hue;
              ctx.beginPath();
              ctx.arc(n.x, n.y, ART_RADIUS, arc.from, arc.to);
              ctx.stroke();
            }
            if (hues.length === 0) {
              ctx.lineWidth = 1 / cam.z;
              ctx.strokeStyle = paint.border;
              ctx.beginPath(); ctx.arc(n.x, n.y, ART_RADIUS, 0, TAU); ctx.stroke();
            }
          }

          if (matchIds?.has(n.id)) {
            ctx.lineWidth = 2.5 / cam.z;
            ctx.strokeStyle = paint.accent;
            if (mode === "card") {
              ctx.strokeRect(n.x - cardW / 2 - 3, n.y - cardH / 2 - 3, cardW + 6, cardH + 6);
            } else {
              ctx.beginPath(); ctx.arc(n.x, n.y, ART_RADIUS + 3, 0, TAU); ctx.stroke();
            }
          }

          if (copies > 1) {
            ctx.font = `500 ${10 / cam.z}px "JetBrains Mono", ui-monospace, monospace`;
            ctx.textAlign = "center";
            ctx.fillStyle = paint.fg;
            ctx.fillText(`×${copies}`, n.x, n.y + ART_RADIUS + 11 / cam.z);
          }
          continue;
        }

        if (n.kind === "face") {
          ctx.fillStyle = colorOf(n.kind);
          ctx.beginPath(); ctx.arc(n.x, n.y, nodeRadius(n), 0, TAU); ctx.fill();
          continue;
        }

        // Every other kind draws its authored glyph instead of an abstract dot (Step 4).
        const scale = nodeRadius(n) / GLYPH_BOX_HALF;
        ctx.save();
        ctx.translate(n.x, n.y);
        ctx.scale(scale, scale);
        ctx.translate(-GLYPH_BOX_HALF, -GLYPH_BOX_HALF);
        ctx.lineWidth = 2;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.strokeStyle = n.kind === "event" ? paint.accent : paint.muted;
        ctx.stroke(pathFor(glyphFor(n)));
        ctx.restore();
      }
      // Restored on every path out of the loop above (each branch either falls through to here or
      // `continue`s back to the top, where it is set again next iteration) -- canvas state is
      // global and persistent, so a search left dimming on would leak into the hub labels below.
      ctx.globalAlpha = 1;

      // Only hubs get labels, highest degree first, and a label is dropped when it would collide
      // with one already drawn. Without this the centre of a dense deck stacks four event names on
      // top of each other and none of them are readable.
      ctx.fillStyle = paint.fg;
      ctx.textAlign = "start"; // the hub labels' collision boxes below assume left alignment
      const fontPx = 11 / cam.z;
      ctx.font = `${fontPx}px ui-monospace, monospace`;
      const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
      const labelled = nodes
        .filter((n) => visible(n) && n.kind !== "card" && n.kind !== "face" && n.deg >= 6)
        .sort((a, b) => b.deg - a.deg);
      for (const n of labelled) {
        const x = n.x + nodeRadius(n) + 4;
        const y = n.y + fontPx / 3;
        const box = { x, y: y - fontPx, w: ctx.measureText(n.label).width, h: fontPx * 1.35 };
        const clash = placed.some(
          (p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y,
        );
        if (clash) continue;
        placed.push(box);
        ctx.fillText(n.label, x, y);
      }
    };

    // The projection runs between tick() and draw() because that is the only point which is after
    // d3's integration and before anything is painted: a frame must never show a card inside a
    // room it does not belong to, not even for one frame. See board-force.ts's doc comment.
    //
    // simCards is hoisted out of the loop -- the filter would otherwise rebuild a 94-element array
    // every frame for a membership set that cannot change without this effect re-running.
    const simCards = nodes.filter((n) => n.kind === "card");
    const loop = () => {
      simulation.tick();
      unresolved = projectRoomMembership(simCards, roomCirclesNow(), roomsByNode);
      draw();
      raf = requestAnimationFrame(loop);
    };
    loop();

    // Room geometry is now derived from card positions (roomCirclesNow(), recomputed every
    // draw), not the viewport -- a resize only needs the canvas's own backing-store size updated.
    // cam.x/y (the zoom translate) is deliberately left untouched: it is now an absolute,
    // top-left-anchored offset, not a centre-relative one, so there is no dim-dependent term in it
    // to recompute. A resize keeps the current pan/zoom exactly where it was on screen -- the same
    // "don't yank the view out from under the user" choice `hidden`/preset changes already make via
    // camRef -- rather than re-centring the board, which would fight a user who has already panned.
    const onResize = () => { dim = size(); };
    addEventListener("resize", onResize);

    // cam.x/y are top-left-anchored (see draw()'s doc comment above), the same convention
    // `pointer(event)` uses, so this is a plain, unshifted inverse of that same transform.
    const toWorld = (ev: { clientX: number; clientY: number }): Point => {
      const r = canvas.getBoundingClientRect();
      const [x, y] = zoomIdentity
        .translate(cam.x, cam.y)
        .scale(cam.z)
        .invert([ev.clientX - r.left, ev.clientY - r.top]);
      return { x, y };
    };

    // Split from `pick` so `onMove` can compute the world point once (via `toWorld`) and hand it to
    // both this and `roomsUnder`, rather than re-deriving it (and re-reading
    // `getBoundingClientRect`) a second time -- see `onMove` below.
    const pickAt = (wx: number, wy: number): Sim | null => {
      // Card mode paints a 5:7 RECTANGLE (ART_RADIUS*2 wide, *1.4 tall -- see draw()'s
      // `mode === "card"` branch), not the disc nodeRadius() reports for the sim/miniature paint.
      // Hit-testing the inscribed circle there left the top/bottom bands and all four corners --
      // including the flip glyph itself, painted in a corner -- dead to the pointer. Computed once
      // per pick rather than per node: it depends only on cam.z, not on which node is being tested.
      const cardMode = renderModeFor(cam.z) === "card";
      let best: Sim | null = null, bd = Infinity;
      for (const n of nodes) {
        if (!visible(n)) continue;
        const dx = n.x - wx, dy = n.y - wy;
        const inside = cardMode && n.kind === "card"
          ? Math.abs(dx) <= ART_RADIUS && Math.abs(dy) <= ART_RADIUS * 1.4
          // Normalised: distance as a fraction of the node's own drawn radius, so every other
          // node is clickable exactly where it is painted rather than inside a fixed box.
          : Math.hypot(dx, dy) / nodeRadius(n) <= 1;
        if (!inside) continue;
        const d = Math.hypot(dx, dy) / nodeRadius(n);
        if (d < bd) { bd = d; best = n; }
      }
      return best;
    };

    const pick = (ev: { clientX: number; clientY: number }): Sim | null => {
      const { x: wx, y: wy } = toWorld(ev);
      return pickAt(wx, wy);
    };

    // d3-selection appears here and NOWHERE else: binding a zoom behaviour to the canvas, which is
    // already an imperative escape hatch outside React's tree. It must never drive React's DOM.
    const zoomBehavior = d3zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.15, MAX_Z])
      .on("zoom", (e: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        cam.x = e.transform.x; cam.y = e.transform.y; cam.z = e.transform.k;
        // A pan moves the board under the pointer, so whichever rooms were lit no longer are.
        setHoveredRooms((prev) => (prev.length === 0 ? prev : []));
      });
    // A pan and a click arrive as the same physical mousedown -> up. d3-zoom reports the transform
    // at gesture start; comparing it to the transform at gesture END is the same question
    // traveledAsPan answers, asked at the one moment a gesture is known to be over.
    let gestureStart = zoomIdentity;
    zoomBehavior.on("start", (e: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
      gestureStart = e.transform;
    });
    const selection = select(canvas);
    selection.call(zoomBehavior);
    // Seed the behaviour with the camera the ref already holds, so a re-run of this effect (a
    // filter toggle, a preset change) does not snap the view back to the origin -- cam.x/y is
    // already an absolute, top-left-anchored translate by then (the "zoom" handler above writes
    // it straight out of d3-zoom's own transform), so re-seeding with it verbatim is a no-op.
    // Only the very FIRST layout (camRef still at its useRef default of {x:0,y:0,z:1}) needs the
    // dim.w/2 + dim.h/2 term baked in, so an unmodified board still opens centred under the new
    // top-left convention -- adding it on every re-run instead would double the offset each time.
    selection.call(
      zoomBehavior.transform,
      isFirstLayout
        ? zoomIdentity.translate(dim.w / 2 + cam.x, dim.h / 2 + cam.y).scale(cam.z)
        : zoomIdentity.translate(cam.x, cam.y).scale(cam.z),
    );
    // The Card/Miniature debug buttons (outside this effect, see jumpZoomRef's doc comment) jump
    // straight to a zoom level with no pointer gesture behind it. Routed through
    // zoomBehavior.transform rather than a raw `cam.z` write so the canvas's own `__zoom` stays
    // truthful for the next real gesture. `.transform()`'s own "start" event still fires with the
    // OLD transform (there is no drag here for gestureStart to protect), so it is set again here,
    // by hand, to the value this jump actually lands on -- otherwise a click right after the jump
    // would read a one-step-stale baseline and the guard above would swallow it as a false drag.
    const jumpZoom = (z: number) => {
      const t = zoomIdentity.translate(cam.x, cam.y).scale(z);
      selection.call(zoomBehavior.transform, t);
      gestureStart = t;
    };
    jumpZoomRef.current = jumpZoom;

    // Fix round 2: this used to be a DOM "click" listener. It cannot be -- d3-zoom's own mousedown
    // handler (mousedowned in zoom.js) hands panning off to d3-drag underneath it, and d3-drag's
    // mouseupped installs a CAPTURE-PHASE handler on the window that calls
    // stopImmediatePropagation() on the very next "click" the instant the pointer moved AT ALL
    // during the gesture (g.moved, set unconditionally on the first pixel of movement -- d3-zoom
    // exposes no clickDistance() the way d3-drag does). Capture fires before bubbling ever reaches
    // this canvas, so a "click" listener here never sees that event at all: only a PERFECTLY
    // stationary press ever produced a DOM click, regardless of what CLICK_DRAG_PX said. `"end"`
    // fires unconditionally for every gesture -- swallowed click or not -- so it is the only event
    // this can be driven from now. Both paths staying wired would double-flip a zero-movement
    // click (the DOM click still fires for that one case, since nothing swallows it): "end" is now
    // the SOLE source of truth, not a fallback.
    //
    // A card only flips when clicked at card scale AND it has a back face to flip to -- anything
    // else (a non-flippable card, any card in miniature mode, empty space) must fall through with
    // no change to existing click behaviour, which is why this checks `renderModeFor(cam.z)` and
    // `faceArt` itself rather than relying on what mode the paint loop happened to draw last frame.
    zoomBehavior.on("end", (e: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
      // "end" fires for every gesture that reaches gesture()'s active-count-to-zero moment, not
      // just a mouse click-or-drag: a wheel zoom debounces into its own gesture with an end (see
      // wheelidled in zoom.js), and the programmatic transforms above (the initial seed, jumpZoom)
      // run the whole start/zoom/end lifecycle in one synchronous call with no event at all. Gated
      // on the literal event TYPE, not `instanceof MouseEvent` -- WheelEvent extends MouseEvent in
      // the DOM, so that check would not exclude a wheel gesture's end.
      //
      // Fix round 3: a touch tap reaches "end" too (touchended in zoom.js), carrying a real
      // TouchEvent as sourceEvent -- before round 2 this flipped via the DOM "click" a browser
      // synthesizes after a tap, since d3-drag's capture-phase click-swallowing (round 2's finding)
      // lives only in mousedowned/mouseupped, never in the touch path. Once "click" stopped being
      // the source of truth, touch needed its own admission here. `pick()` reads clientX/clientY,
      // which a TouchEvent doesn't carry directly -- they live on changedTouches[0] instead. d3
      // binds touchended to BOTH "touchend" and "touchcancel" in one `.on()` string, so a cancel is
      // deliberately NOT admitted; and changedTouches can in principle be empty, so `point` falls
      // through to `null` rather than reading index 0 of nothing.
      const src = e.sourceEvent as (MouseEvent | TouchEvent) | null;
      const point =
        src?.type === "mouseup" ? (src as MouseEvent)
        : src?.type === "touchend" ? ((src as TouchEvent).changedTouches[0] ?? null)
        : null;
      if (!point) return;
      if (traveledAsPan(gestureStart, e.transform)) return;
      const hit = pick(point);
      if (
        hit && hit.kind === "card" && renderModeFor(cam.z) === "card"
        && faceArt.has(`${hit.id.replace(/^card:/, "face:")}:1`)
      ) {
        setFlipped((prev) => {
          const next = new Set(prev);
          if (!next.delete(hit.id)) next.add(hit.id);
          return next;
        });
      }
    });
    const onMove = (e: PointerEvent) => {
      // Computed once and handed to both the node hit-test and the room lookup below -- each used
      // to call toWorld (and its own getBoundingClientRect) separately.
      const w = toWorld(e);
      const n = pickAt(w.x, w.y);
      const r = canvas.getBoundingClientRect();
      // The canvas shows only room labels now (Task 5+), so the detailed build-category
      // vocabulary lives here instead -- a card's roles, translated to plain language.
      const detail = n && n.kind === "card" ? (n.roles ?? []).map(subcategoryLabel).join(" · ") : "";
      setHover(n
        ? { label: n.label, kind: n.kind, deg: n.deg, detail, x: e.clientX - r.left, y: e.clientY - r.top }
        : null);
      // Additive to the node tooltip, not a replacement: hovering a card inside two rooms shows
      // the card's own tooltip AND lights both legend rows.
      const under = roomsUnder(w.x, w.y, lastCircles);
      // Only write when the set actually changed -- pointermove fires far more often than the
      // answer changes, and every write is a React render.
      setHoveredRooms((prev) =>
        prev.length === under.length && prev.every((id, i) => id === under[i]) ? prev : under,
      );
    };

    canvas.addEventListener("pointermove", onMove);
    return () => {
      // Snapshot final positions so the next effect run (a graph or filter change) can reuse them
      // instead of re-throwing everything -- see Step 0.
      for (const n of nodes) prevPositions.set(n.id, n);
      simulation.stop();
      cancelAnimationFrame(raf);
      removeEventListener("resize", onResize);
      canvas.removeEventListener("pointermove", onMove);
      // Also removes the "end" listener above -- click-to-flip is wired entirely through
      // zoomBehavior now, no separate DOM "click" listener to tear down.
      selection.on(".zoom", null);
      delete (canvas as unknown as { __graphProbe?: () => unknown }).__graphProbe;
    };
    // `flipped` and `faceArt` are deliberately absent here -- see flippedRef's doc comment above.
    // `faceArt` is memoised on `graph`, which is already a dep, so it buys nothing as a dep of its
    // own and would only invite the same reheat mistake later.
    //
    // `rooms` and `hueOf` ARE deps, deliberately, unlike `flipped`/`matches` above: switching the
    // preset chip changes which room each card is in, and room membership is read inside
    // this effect's own tick() (the room-attraction force) and draw() (the room circles, labels,
    // and rim hues) -- there is no way to repaint that without the effect re-running. This is the
    // SAME class of re-run `hidden` (the kind-filter chips) already causes, not a new one: the
    // effect's own teardown snapshots positions into `prevPositions` first, so remounting finds
    // `isFirstLayout` false and reheats at the partial alpha (0.3), never the full-energy reset
    // (alpha 1) a first mount gets. `roomsByNode` and `tallies` are both already deps and are
    // themselves derived from `rooms`, so listing `rooms`/`hueOf` too does not add a NEW class of
    // re-run, just names the dependency that was already implicitly driving the two that were
    // already here.
    //
    // `params` joins the deps for the dev tuning panel: moving a slider re-runs this effect, which
    // resumes every node from prevPositionsRef and reheats to alpha 0.3 -- the board re-settles at
    // the new constant rather than jumping. Outside dev it is DEFAULT_PARAMS and never changes
    // identity, so this costs a production render nothing.
  }, [graph, hidden, roomsByNode, tallies, rooms, hueOf, params]);

  /** Reshapes __graphProbe()'s node array (with its `circles` property riding along, see the probe's
   *  own comment) into what BoardTuner reads. Returns null before the first layout effect has run,
   *  or under a test with no canvas context. */
  const probeSnapshot = useCallback((): ProbeSnapshot | null => {
    const probe = (canvasRef.current as unknown as { __graphProbe?: () => unknown })?.__graphProbe;
    if (!probe) return null;
    const nodes = probe() as (
      { kind: string; x: number; y: number; rooms: readonly string[] | null }[]
      & { circles?: readonly { id: string; x: number; y: number; r: number }[] }
      & { unresolved?: number }
    );
    return {
      cards: nodes.filter((n) => n.kind === "card"),
      circles: nodes.circles ?? [],
      unresolved: nodes.unresolved ?? 0,
    };
  }, []);

  const toggle = (k: NodeKind) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const kinds = KIND_ORDER.filter((k) => counts.has(k));

  return (
    <div className="flex flex-col gap-6">
      {/* The fullscreen element (and its opaque ::backdrop) obscure every sibling in the
       *  document while active -- Escape would otherwise be the only way out, since the exit
       *  button would render behind the backdrop. shellRef therefore wraps the button row AND
       *  the canvas, not just the canvas, so "exit fullscreen" stays reachable the whole time. */}
      <div
        ref={shellRef}
        data-testid="graph-fullscreen-shell"
        className={`flex flex-col gap-6 ${isFullscreen ? "h-screen bg-(--background)" : ""}`}
      >
        <div className="flex flex-wrap gap-2">
          {/* Which predicate groups the board. Chips, not a <select>: this is the primary control
           *  on this view and the one thing a reader changes on purpose. Plain state, not a ref
           *  like `cam` -- switching it genuinely changes which room every card is in, so a real
           *  re-render (and the layout effect re-running) is correct here. */}
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={p.id === presetId}
              onClick={() => setPresetId(p.id)}
              className={`eyebrow rounded-(--radius) border px-2.5 py-1 ${
                p.id === presetId ? "border-(--accent) text-(--accent)" : "border-(--separator) text-(--muted)"
              }`}
            >
              {p.label}
            </button>
          ))}

          {debug
            ? kinds.map((k) => {
                const on = !hidden.has(k);
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(k)}
                    className={`eyebrow rounded-(--radius) border px-2.5 py-1 ${
                      on ? "border-(--accent) text-(--accent)" : "border-(--separator) text-(--muted)"
                    }`}
                  >
                    {k} <span className="tabular-nums">{counts.get(k)}</span>
                  </button>
                );
              })
            : null}

          {/* Jumps the camera through zoomBehavior (jumpZoomRef, set by the layout effect) rather
           *  than through React state -- the paint loop reads cam.z every frame, so there is
           *  nothing for a re-render to do here, and going through zoomBehavior keeps its own
           *  bookkeeping in sync with cam (see jumpZoomRef's doc comment above). */}
          {debug ? (
            <>
              <button type="button" className="eyebrow" onClick={() => jumpZoomRef.current(CARD_MODE_Z)}>
                Card
              </button>
              <button type="button" className="eyebrow" onClick={() => jumpZoomRef.current(1)}>
                Miniature
              </button>
            </>
          ) : null}

          <button
            type="button"
            aria-pressed={debug}
            onClick={() => setDebug((d) => !d)}
            className={`eyebrow rounded-(--radius) border px-2.5 py-1 ${
              debug ? "border-(--accent) text-(--accent)" : "border-(--separator) text-(--muted)"
            }`}
          >
            debug
          </button>

          {canFullscreen ? (
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-pressed={isFullscreen}
              className="eyebrow rounded-(--radius) border border-(--separator) text-(--muted) px-2.5 py-1 ml-auto"
            >
              {isFullscreen ? "exit fullscreen" : "fullscreen"}
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <input
            type="search"
            role="searchbox"
            aria-label="Find a card"
            placeholder="Find a card…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="rounded-(--radius) border border-(--separator) bg-transparent px-2.5 py-1 text-sm"
          />
          {matches ? (
            <span data-testid="graph-search-count" className="eyebrow text-(--muted)">
              {matches.size > 0 ? `${matches.size} match${matches.size === 1 ? "" : "es"}` : "no matches"}
            </span>
          ) : null}
        </div>

        <div
          className={`relative rounded-(--radius) border border-(--border) overflow-hidden ${
            isFullscreen ? "flex-1 min-h-0" : "h-[380px] sm:h-[520px]"
          }`}
        >
          <canvas
            ref={canvasRef}
            className="block w-full h-full cursor-grab touch-none"
            aria-label={`Deck graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`}
          />
          {/* The room labels, in the DOM rather than on the canvas -- see draw()'s room loop for
           *  why placement on the canvas could not be made stable under zoom. Absolutely
           *  positioned inside the existing `relative` wrapper, same treatment as the hover
           *  tooltip below -- and the OUTER container is `pointer-events-none` for the same reason
           *  that tooltip has it: the canvas binds pointerdown/up/move/click/wheel directly on
           *  itself (not delegated from the wrapper), so a sibling that captured pointer events
           *  would put a dead zone over the board wherever it sits.
           *
           *  Ordering is the preset's own room order (declaration order for role, member count
           *  descending for the derived presets), already stable.
           *
           *  Twelve rows then scroll: the subtype preset produces 40-80 rooms for one deck. The
           *  cap is on DISPLAY only -- every room still draws, still tallies, still contains.
           *  `--legend-row-h` is the ONE source of truth for the row height, read by both the row
           *  itself and the scroll cap's `calc(${LEGEND_VISIBLE_ROWS} * ...)` -- so the two numbers
           *  can't drift apart the way two independent literals could. The cap and `overflow-y-auto`
           *  live on an INNER element with no padding/border, so Preflight's border-box sizing can't
           *  eat into the budget the way it would if the cap sat on the padded/bordered outer
           *  container.
           *
           *  `pointer-events-none` is inherited, so putting it on the outer container also disabled
           *  the scroller underneath it -- fix round 1 introduced that regression by fixing the
           *  canvas dead-zone and the scroll cap in the same pass without reconciling them. The
           *  scroller only re-enables pointer events (`pointer-events-auto`) when there is
           *  something to scroll TO -- more rooms than fit -- since that's the only case where
           *  paying a dead zone over the canvas buys anything; at or under the cap every room is
           *  already visible and the canvas keeps its whole surface. */}
          <div
            data-testid="room-legend"
            role="group"
            aria-label="Room legend"
            className="pointer-events-none absolute left-2 top-2 rounded-(--radius) border border-(--border) bg-(--background)/90 px-2 py-1 text-xs"
            style={{ "--legend-row-h": "1.625rem" } as CSSProperties}
          >
            <div
              data-testid="room-legend-scroll"
              className={`overflow-y-auto ${rooms.length > LEGEND_VISIBLE_ROWS ? "pointer-events-auto" : ""}`}
              style={{ maxHeight: `calc(${LEGEND_VISIBLE_ROWS} * var(--legend-row-h))` }}
            >
              {rooms.map((room) => {
                const tally = tallies.get(room.id);
                const count = tally ? (tally.target > 0 ? `${tally.count}/${tally.target}` : `${tally.count}`) : "";
                const under = tally?.under ?? false;
                return (
                  <div
                    key={room.id}
                    data-testid="room-legend-row"
                    data-room={room.id}
                    data-under={under ? "true" : "false"}
                    data-hovered={hoveredRooms.includes(room.id) ? "true" : "false"}
                    style={{ height: "var(--legend-row-h)" }}
                    className={`flex items-center gap-1.5 ${under ? "text-(--warning)" : ""} ${
                      hoveredRooms.includes(room.id) ? "bg-(--separator)" : ""
                    }`}
                  >
                    {/* The room's OWN hue -- a graphic object next to text, so it carries the 3:1
                     *  floor ROOM_HUE was validated against. The text beside it is the page's
                     *  normal foreground, which is why ROOM_HUE_TEXT could be deleted. */}
                    <span
                      aria-hidden="true"
                      style={{ background: room.hue }}
                      className="inline-block size-2.5 shrink-0 rounded-full"
                    />
                    <span className="whitespace-nowrap">{room.label}</span>
                    {/* No `text-(--muted)` when under -- the amber has to reach the number itself
                     *  (BOARD WIPES 0/3), not just the room name beside it. */}
                    <span className={`font-mono tabular-nums ${under ? "" : "text-(--muted)"}`}>
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          {hover ? (
            <div
              className="pointer-events-none absolute rounded-(--radius) border border-(--border) bg-(--background) px-2 py-1 text-xs whitespace-nowrap"
              style={{ left: hover.x + 12, top: hover.y + 12 }}
            >
              {hover.label}{" "}
              <span className="text-(--muted) font-mono tabular-nums">
                {hover.kind} · {hover.deg}
              </span>
              {hover.detail ? <span className="text-(--muted)"> · {hover.detail}</span> : null}
            </div>
          ) : null}

          {/* import.meta.env.DEV is a compile-time constant, so Vite drops this branch and the
           *  BoardTuner import entirely from a production build. `debug` is the toggle that
           *  already reveals the kind chips and the Card/Miniature buttons -- the panel joins
           *  them rather than inventing a second way in. Rendered INSIDE this `relative` wrapper
           *  (not the toolbar row above) so BoardTuner's own `absolute top-2 right-2` resolves
           *  against the canvas, not the page -- design doc §5: "positioned over a corner of the
           *  canvas". */}
          {import.meta.env.DEV && debug ? (
            <BoardTuner params={params} onChange={setParams} probe={probeSnapshot} />
          ) : null}
        </div>
      </div>
      <p className="text-(--muted) text-sm">
        Drag to pan, scroll to zoom. Accent nodes are events — a card emits into one and another
        triggers off it, so a synergy is two hops rather than a stored pair.
      </p>

      {legend.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {legend.map(([key, glyph]) => (
            <span
              key={key}
              className="eyebrow flex items-center gap-1.5 rounded-(--radius) border border-(--separator) px-2 py-1 text-(--muted)"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={glyph} />
              </svg>
              {key}
            </span>
          ))}
        </div>
      ) : null}

      {events.length === 0 ? (
        <p className="text-(--muted) text-sm">No synergy events in this deck.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[22rem]">
            <thead>
              <tr className="border-b border-(--border)">
                <th className="eyebrow text-left pb-2">Event</th>
                <th className="eyebrow text-right pb-2">Emitters</th>
                <th className="eyebrow text-right pb-2">Payoffs</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.key} className="border-b border-(--separator)">
                  <td className="py-1.5 font-mono">{e.key}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">{e.emitters}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">{e.payoffs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
