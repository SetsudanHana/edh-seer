import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type D3ZoomEvent } from "d3-zoom";
import type { CardGraph, DeckReport } from "../types.js";
import { createArtLoader, type ArtLoader } from "./art-loader.js";
import { cachedImageLoad } from "./art-cache.js";
import {
  CARD_MODE_Z, MAX_Z, cardImageUrl, isOnScreen, renderModeFor, shouldPrefetchCard,
} from "./card-node.js";
import {
  FLOW_DASH, FLOW_EVENT_HUES, FLOW_HUE, OVERFLOW_HUE, PAINT_MODES, paintHues, paintLegend, rimArcs, subcategoryLabel,
} from "./presets.js";
import { computeFlow, type Flow, type FlowEdge } from "./flow.js";
import { eventLabel } from "../lib/demand-sentence.js";
import {
  ART_RADIUS,
  EDIT_REHEAT_ALPHA, CARD_H, CARD_W, createBoardSimulation, DEFAULT_PARAMS, linkDistanceFor, nodeRadius,
  PARK_ALPHA,
  type BoardParams, type Sim, type SimLink,
} from "./board-force.js";
import { BoardTuner, type ProbeSnapshot } from "./BoardTuner.js";
import { CardInspector } from "./CardInspector.js";
import { labelCandidates, labelPriority, placeLabels } from "./labels.js";
// Re-exported so this module stays the import site every consumer (and GraphView.test.tsx) already
// uses, while board-force.ts owns the values.
export { ART_RADIUS, nodeRadius };
export type { Sim } from "./board-force.js";

const TAU = Math.PI * 2;

/** Height, in world units, of a paint-hue bar along a card-mode card's bottom edge. The card-mode
 *  answer to a rim arc: a 5:7 rectangle has no rim to stroke arcs onto. */
const BAR_H = 3;

/** Stroke width, in world units, of the weakest and the strongest edge on the board. Weight is
 *  already spent on DISTANCE (linkDistanceFor), so this is redundancy rather than the only signal
 *  -- which is what makes a narrow range right: it has to survive a 95-node board without turning
 *  the middle into a solid sheet. */
const EDGE_W_MIN = 0.4;
const EDGE_W_MAX = 2.2;

/** Opacity of the weakest and the strongest edge. THE THIRD CHANNEL WEIGHT WAS NOT SPENDING: it
 *  already buys distance (linkDistanceFor) and width (above), while every edge on the board was
 *  painted at full opacity in a border colour -- so the mesh read as uniform grey noise and the
 *  strong relationships, which are the product, were indistinguishable from the incidental ones.
 *  A narrow floor rather than 0: a weak edge is still a real claim and must not vanish. */
const EDGE_A_MIN = 0.14;
const EDGE_A_MAX = 0.72;

/** HOVER IS A ONE-HOP PREVIEW OF THE FLOW (roadmap H8). Clicking a card was the ONLY way to see
 *  what it relates to, which is a fine report and a poor deckbuilding surface -- a player sweeping
 *  the board should be able to read a card's relations without committing to a selection. Gentler
 *  than the flow's 0.15 on purpose: a hover is a glance, so the rest of the deck stays legible
 *  behind it rather than going out. A multiplier on the edge's own weight-driven alpha, so the
 *  strong/weak reading H2 added survives the dim. */
const HOVER_EDGE_DIM = 0.3;
const HOVER_NODE_DIM = 0.45;

/** A card with `deg === 0` sits on the board by repulsion and centre-pull alone -- its POSITION
 *  carries no synergy information. A blind judge, shown a correctly fitted and labelled board,
 *  named two edgeless lands as the deck's most strongly related pair: their arbitrary proximity
 *  plus a matching paint-mode ring colour read as a relationship (task-12 brief). These knock
 *  every cue an edgeless card would otherwise share with a connected one -- size, opacity, AND
 *  colour, not opacity alone -- so proximity by itself can no longer read as synergy. Paint only:
 *  the node stays in the force simulation at its full-weight position; only how it is drawn here
 *  changes. */
const EDGELESS_ALPHA = 0.4;
const EDGELESS_RADIUS_SCALE = 0.55;

/** Screen px a card-name label renders at, held constant across zoom -- world-unit font size is
 *  `LABEL_PX / cam.z`, same trick as the ×copies badge a few lines below. The formula was never the
 *  defect (see labels.ts); what got labels deleted was letting the measured box feed back into
 *  layout. It never does here: this constant reaches only the label pass at the end of draw(). */
const LABEL_PX = 11;

/** Breathing room around a label's COLLISION box, in screen px. `placeLabels` rejects an exact
 *  overlap, so two names could sit a pixel apart and read as one run of text — which is what the
 *  central cluster looked like at default zoom. Applied to the collision box only; the text is
 *  still drawn at the node. */
const LABEL_GAP = 4;
/** Below this zoom, most of the board is too small on screen for a name to mean anything -- only a
 *  commander or whatever's under the pointer still gets one. */
const LABEL_ZOOM_FLOOR = 0.6;

/** Fraction of the canvas the fitted board occupies on whichever axis is tighter -- a board that
 *  touches the edges reads as cropped, not framed. */
const FIT_MARGIN = 0.9;
/** How settled the board has to be before the one-time fit-to-view reads its bounding box. Close to
 *  a magic tick count: alpha decays at a fixed per-TICK rate regardless of frame rate, so this lands
 *  at the same physical amount of settling on a slow device as a fast one. UPDATED 2026-08-20 with
 *  `ALPHA_FLOOR` 0.02 -> 0 (roadmap H1): alpha now decays toward ZERO, so it crosses 0.05 at tick
 *  ~600 (was 696, when it was decaying toward a 0.02 floor and levelled at 0.038 by tick 800). The
 *  fit therefore fires slightly EARLIER and against a board that will actually come to rest;
 *  board-layout.harness.ts still gates at 800 ticks, which is now mid-settle by design -- see
 *  QUALITY_CAPS. A fit read from the unsettled seed cloud (tick 0) would frame where
 *  the cards temporarily are, not where they end up, and go stale the moment the layout spreads.
 *  That window is seconds long, so a user CAN zoom inside it: the "zoom" handler cancels the
 *  pending fit when it sees a real gesture, or the fit would overwrite their camera. */
const FIT_SETTLE_ALPHA = 0.05;

type Point = { x: number; y: number };

/** Screen pixels of camera translation between a zoom gesture's start and its end, below which the
 *  gesture still counts as a click rather than a pan. Not zero: real hardware never reports an
 *  intended click as exactly stationary -- and on a trackpad, essentially no click is. */
const CLICK_DRAG_PX = 4;

/** Whether a zoom gesture's start and end transforms differ enough to have been a pan rather than
 *  a click. Pulled out as its own pure function because this jsdom cannot construct a real
 *  mousedown-driven zoom gesture at all (see GraphView.test.tsx), so the arithmetic is what's
 *  unit-testable, not the gesture that produces its inputs. A scale change alone (`end.k !==
 *  start.k`) counts as a pan even with zero translation -- a click can't zoom the camera, so any
 *  "click" reporting a different scale from where the gesture started did not, in fact, just
 *  click. */
export function traveledAsPan(
  start: { x: number; y: number; k: number },
  end: { x: number; y: number; k: number },
  threshold = CLICK_DRAG_PX,
): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) > threshold || end.k !== start.k;
}

/** A stable pseudo-random number in [0, 1) for a node id — FNV-1a, so the SAME deck lays out the
 *  same way on every page load. This was `Math.random()`, which made the seed cloud different every
 *  time: a report can shrug at that, but the board is becoming a deckbuilding surface, and a player
 *  who has learned where their combo sits should not have to re-learn it because they refreshed.
 *  `salt` gives the y axis its own draw without a second hash function. */
export function jitterFromId(id: string, salt = ""): number {
  let h = 0x811c9dc5;
  const s = `${id}${salt}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
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

/** Stroke width for one edge, scaled by weight against the deck's own maximum -- the same
 *  normalisation linkDistanceFor uses, and for the same reason: the weight scale is unbounded. */
export function edgeWidth(weight: number, maxWeight: number): number {
  if (maxWeight <= 0) return EDGE_W_MIN;
  const t = Math.min(1, Math.max(0, weight / maxWeight));
  return EDGE_W_MIN + t * (EDGE_W_MAX - EDGE_W_MIN);
}

/** Opacity for one edge, on the same deck-relative normalisation `edgeWidth` uses. Width alone
 *  cannot separate 300 edges -- at these zooms the difference between 0.4 and 2.2 world units is
 *  under two device pixels -- so the strong third of a deck's relationships now also reads darker
 *  than the incidental two-thirds. */
export function edgeAlpha(weight: number, maxWeight: number): number {
  if (maxWeight <= 0) return EDGE_A_MIN;
  const t = Math.min(1, Math.max(0, weight / maxWeight));
  return EDGE_A_MIN + t * (EDGE_A_MAX - EDGE_A_MIN);
}

export function GraphView(
  { graph: fullGraph, report, artLoader: injectedArtLoader }:
  { graph: CardGraph; report: DeckReport; artLoader?: ArtLoader },
) {
  /** Reveal the tokens nothing but their own maker relates to. Off by default: a deck that makes
   *  Clues nobody cares about would otherwise scatter disconnected discs across the board. The data
   *  carries them either way -- that isolation IS a deckbuilding signal, which is why this is a view
   *  filter and not an omission upstream. */
  const [showLoneTokens, setShowLoneTokens] = useState(false);
  // LANDS ARE OFF BY DEFAULT, and it is the caption below that makes this a correctness fix rather
  // than a preference: "two cards sit close because they do something for each other". 37 of this
  // deck's 101 nodes are lands, nearly all of them edgeless, so a third of the board was a ring of
  // discs the sentence is false about — and the cluster the sentence IS about got the middle third
  // of the canvas to fit in.
  const [showLands, setShowLands] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<
    { label: string; copies: number; deg: number; detail: string; x: number; y: number } | null
  >(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [query, setQuery] = useState("");
  // Which card the provenance inspector is open on, or null when it's closed. Set by the click
  // path (zoomBehavior's "end" handler, below) and by the panel's own close button. Not a ref --
  // unlike hoveredIdRef/matchesRef this DOES need to drive a render (the panel is real DOM, not a
  // canvas draw), and a click is a discrete event, not a per-frame or per-keystroke one, so there
  // is no reheating-the-simulation cost to worry about here.
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  /** Which facet the board is PAINTED by. It moves no node: geometry is synergy and only synergy,
   *  so switching this is a restyle of a layout that never re-simulates. */
  const [paintId, setPaintId] = useState(PAINT_MODES[0].id);
  /** WHICH EVENT THE READER IS TRACING, or null for all of them.
   *
   *  Owner-reported 2026-08-27: "when I click a card this shows me the flow of events, but I cannot
   *  distinguish them, or filter them — say I am interested in the flow of a specific event through
   *  the deck". The board could say WHAT connects to what and never WHICH MECHANISM did it, so a
   *  deck's `dies` chain and its `enters` chain were one indistinguishable mesh.
   *
   *  A FILTER RATHER THAN A COLOUR, and that is the design decision. Colouring edges by event needs
   *  one hue per verb; this corpus has ~20 and a categorical palette holds 6-8 before the colours
   *  stop being tellable apart — the rainbow would be less legible than the mesh it replaced. Naming
   *  one event and dimming the rest scales to any number of them, and it is the same
   *  dim-rather-than-hide grammar the search already uses, so the deck keeps its shape. */
  const [eventVerb, setEventVerb] = useState<string | null>(null);
  // Capability check rather than a user-agent sniff: iOS Safari on iPhone has no element
  // fullscreen, and a button that silently does nothing is worse than no button.
  const canFullscreen = typeof Element !== "undefined" && "requestFullscreen" in Element.prototype;
  // Developer instruments (the render-mode buttons, the tuning panel) behind one toggle. Local
  // state on purpose -- it does not persist across mounts.
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

  // Layout continuity: positions of every node as of the last time this effect tore down, keyed by
  // id. Persists across `graph` changes for the life of this component so a re-render moves only
  // what actually changed instead of re-throwing the whole layout.
  // ponytail: never pruned of ids that drop out of the graph, so it grows unbounded for the life
  // of a mounted GraphView. Fine at one deck's worth of nodes per mount; add pruning on teardown
  // (drop ids not in the latest `graph.nodes`) if this component ever stays mounted across many
  // distinct decks in one session.
  const prevPositionsRef = useRef<Map<string, Sim>>(undefined);
  prevPositionsRef.current ??= new Map();
  // Concurrency-capped, spaced, retrying art loader (see art-loader.ts), created once per mount so
  // state (and in-flight requests) survive a graph change re-running the effect. `load` reads
  // through the Cache API first (art-cache.ts) so art already seen renders with the network gone.
  //
  // Prefers the loader `ReportTabs` owns, when there is one: that loader started warming every
  // card's art the moment the analyze response landed, seconds before this tab was ever opened, and
  // taking it means arriving to images already decoded rather than re-requesting them. Falls back to
  // its own so the component still stands alone (which is how every test renders it).
  /** PAINT PARKING. The loop used to tick, draw and reschedule unconditionally, so a board that had
   *  finished settling still repainted 60 times a second forever. `invalidate()` marks a frame owed;
   *  the loop early-outs when none is owed and nothing continuous is running.
   *
   *  THE rAF IS NEVER CANCELLED, deliberately. A missed wake is a FROZEN BOARD, which is far worse
   *  than a warm laptop, so the loop stays alive and a missed invalidation self-heals on the next
   *  one instead of being unrecoverable.
   *
   *  THE CATCH-ALL BELOW IS WHAT MAKES THIS SAFE, and it is one hook rather than six. `huesRef`,
   *  `commandersRef`, `matchesRef` and `flowRef` are all assigned in the COMPONENT BODY, so any
   *  change to what they hold implies a render happened — an effect with NO dependency array runs
   *  after every render and therefore covers all of them, plus any ref added here later. Only the
   *  three drivers with no render behind them need explicit calls: the camera (d3-zoom writes
   *  `cam` directly), the hover id, and art landing (`onSettled`, since `draw()` READS art by
   *  polling and a poll that never runs never sees it). */
  const dirtyRef = useRef(true);
  const invalidate = useCallback(() => { dirtyRef.current = true; }, []);
  useEffect(() => { dirtyRef.current = true; });

  const artLoaderRef = useRef<ArtLoader>(undefined);
  artLoaderRef.current ??= injectedArtLoader ?? createArtLoader({ load: cachedImageLoad() });
  // Whichever loader this ended up with -- `ReportTabs`' shared one, or its own fallback. `draw()`
  // reads art by POLLING, and a parked loop never polls, so an image landing has to say so.
  useEffect(() => artLoaderRef.current!.subscribe(invalidate), [invalidate]);
  // Effect-local until the filter chips existed, which is why toggling one reset the view. A ref
  // survives the effect re-running, and the mode buttons below need to write z from outside it.
  const camRef = useRef({ x: 0, y: 0, z: 1 });
  /** The graph object whose board has already had its ONE-TIME initial fit run. A ref, not
   *  effect-local state, because the fit has to survive the effect being torn down and re-run for
   *  the same deck -- which is what StrictMode does on every dev mount. Used to be the same ref as
   *  `cameraOwnedByUserRef` below, conflating "the initial fit already ran" with "the user has taken
   *  over the camera" -- which is exactly what made a resize unable to tell a camera the fit still
   *  owns (safe to reframe) from one a user just panned (must be left alone), since both read as
   *  "fitted" for the same reason. */
  const fittedGraphRef = useRef<CardGraph | null>(null);
  /** The graph object whose camera a REAL user gesture (not the fit, not the initial seed) has
   *  claimed. A resize consults THIS ref, not `fittedGraphRef`: while it is not the current graph,
   *  the fit still owns the camera and a resize may reframe it for the new canvas size; once a
   *  gesture claims it, a resize must leave the camera exactly alone -- the same promise the
   *  pre-fix `onResize` comment made for a user who had already panned. Set only inside the "zoom"
   *  handler's `sourceEvent` branch below, which is the same signal `fittedGraphRef` already used to
   *  tell a real gesture from a programmatic transform. */
  const cameraOwnedByUserRef = useRef<CardGraph | null>(null);
  // The Card/Miniature debug buttons jump the zoom level with no real pointer gesture behind it.
  // They used to write camRef.current.z directly, which left d3-zoom's own bookkeeping (the
  // canvas's `__zoom`) stale. Written by the layout effect once its zoomBehavior exists; the
  // buttons render before that effect runs and must survive it re-running without going stale,
  // hence a ref rather than a plain closure.
  const jumpZoomRef = useRef<(z: number) => void>(() => {});
  // The card id under the pointer, read by the label pass inside the rAF loop -- a ref rather than
  // `hover` (React state) for the same reason matchesRef/huesRef are refs: reading state there
  // would either be stale between renders or force the layout effect to re-run on every
  // pointermove, reheating the whole simulation as the user just moves the mouse.
  const hoveredIdRef = useRef<string | null>(null);

  /** Node ids of the tokens the default view hides. Matched on `isToken` + label, never on the name
   *  alone: a token can share its name with a real card in the same deck (92 corpus token names do),
   *  and hiding that card's node would delete a real card from the board. */
  const loneTokens = useMemo(() => {
    const lone = new Set(
      (report.tokenNodes ?? []).filter((t) => !t.hasPartner).map((t) => t.name),
    );
    return new Set(
      fullGraph.nodes.filter((n) => n.isToken && lone.has(n.label)).map((n) => n.id),
    );
  }, [fullGraph, report]);

  /** Land nodes, by TYPE LINE rather than by role: `roles` carries the build category, and what
   *  matters here is what the node IS on the board. */
  const landNodes = useMemo(
    () => new Set(fullGraph.nodes.filter((n) => n.types.includes("land")).map((n) => n.id)),
    [fullGraph],
  );

  /** What the board actually draws. Identical object when nothing is hidden, so the layout effect
   *  below (which keys on `graph`) does not re-simulate for decks with nothing to hide. */
  const graph = useMemo(() => {
    const hidden = new Set<string>();
    if (!showLoneTokens) for (const id of loneTokens) hidden.add(id);
    if (!showLands) for (const id of landNodes) hidden.add(id);
    if (hidden.size === 0) return fullGraph;
    return {
      ...fullGraph,
      nodes: fullGraph.nodes.filter((n) => !hidden.has(n.id)),
      edges: fullGraph.edges.filter((e) => !hidden.has(e.from) && !hidden.has(e.to)),
    };
  }, [fullGraph, loneTokens, showLoneTokens, landNodes, showLands]);

  /** The events this deck's edges actually carry, commonest first, with the number of edges each
   *  one explains. Derived from the drawn graph rather than the full one, so hiding lands changes
   *  the counts a reader is choosing between. An edge carries several tags and therefore counts
   *  once per distinct verb — the question is "how many connections would naming this event show
   *  me", and an edge that carries `dies` is one of those whether or not it also carries `cast`. */
  const eventCounts = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of graph.edges) {
      for (const verb of new Set(e.tags.map((t) => t.split(":")[0]))) n.set(verb, (n.get(verb) ?? 0) + 1);
    }
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [graph]);

  /** True when this edge carries the traced event. One predicate, used by the paint loop AND by the
   *  flow walk, so what is drawn and what is walked cannot disagree about what an edge is. */
  const edgeHasEvent = useCallback(
    (e: { tags: string[] }) => eventVerb === null || e.tags.some((t) => t.split(":")[0] === eventVerb),
    [eventVerb],
  );

  /** The edges a flow may walk. Filtering HERE rather than inside `computeFlow` keeps that module
   *  about traversal and this one about what the reader asked to see. */
  const flowEdges = useMemo(
    () => (eventVerb === null ? graph.edges : graph.edges.filter(edgeHasEvent)),
    [graph, eventVerb, edgeHasEvent],
  );

  /** Tag lookup at component scope, for the flow legend below. The paint loop keeps its own
   *  effect-scoped copy: this one is read during render, that one every frame. */
  const tagsByPairBody = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of graph.edges) m.set(`${e.from}>${e.to}`, e.tags);
    return m;
  }, [graph]);

  const paint = PAINT_MODES.find((m) => m.id === paintId) ?? PAINT_MODES[0];
  /** What the current paint mode's colours mean, for this deck. */
  const legend = useMemo(() => paintLegend(paint, graph.nodes), [paint, graph]);

  /** Card id -> the hues it paints, under the CURRENT mode. Rebuilt when the mode changes and read
   *  by the draw loop through a ref, so a mode switch repaints without touching the simulation. */
  const huesById = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const n of graph.nodes) m.set(n.id, paintHues(paint, n));
    return m;
  }, [paint, graph]);
  const huesRef = useRef<Map<string, string[]>>(new Map());
  huesRef.current = huesById;

  // Card names in the command zone. Node ids ARE card names (labels.ts's brief), so this is a
  // direct Set of ids. `report` is otherwise unread by this component -- this is its first real
  // consumer. Read through a ref by the label pass, same reason as huesRef: it runs inside the rAF
  // loop, and `report` is not a dependency of the layout effect below.
  const commanders = useMemo(
    () => new Set(report.cards.filter((c) => c.isCommander).map((c) => c.name)),
    [report],
  );
  const commandersRef = useRef<Set<string>>(new Set());
  commandersRef.current = commanders;

  /** Card node ids matching the current search, or null when the box is empty. Null and "the
   *  empty set" mean different things to the draw pass: null dims nothing, an empty set (a query
   *  that hits zero cards) dims everything. */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const hit = new Set<string>();
    for (const n of graph.nodes) if (n.label.toLowerCase().includes(q)) hit.add(n.id);
    return hit;
  }, [graph, query]);

  /** Matches the board is not drawing, because a filter hides them. `matches` above searches the
   *  DRAWN graph, which is correct for the dimming pass and a false sentence on its own: with lands
   *  hidden (the default, 31 of them on a typical deck) searching "Forest" reported NO MATCHES about
   *  a deck full of Forests. Split by WHY each one is hidden, so the reveal flips only the filter
   *  that is actually in the way. */
  const hiddenMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const drawn = new Set(graph.nodes.map((n) => n.id));
    let lands = 0, tokens = 0;
    for (const n of fullGraph.nodes) {
      if (drawn.has(n.id) || !n.label.toLowerCase().includes(q)) continue;
      if (landNodes.has(n.id)) lands++; else tokens++;
    }
    return lands + tokens > 0 ? { lands, tokens, total: lands + tokens } : null;
  }, [fullGraph, graph, query, landNodes]);

  // The layout effect's draw() reads this through a ref rather than closing over `matches`
  // directly, and `matches` is deliberately absent from that effect's dependency array below --
  // the effect owns the force simulation, and adding `matches` there would reheat and re-seed the
  // whole layout on every keystroke, moving the board under the user while they type.
  const matchesRef = useRef<Set<string> | null>(null);
  matchesRef.current = matches;
  /** The event predicate, read by the paint loop. Assigned in the COMPONENT BODY like every other
   *  ref here, which is exactly what the catch-all invalidation effect above relies on: changing it
   *  implies a render, and that effect wakes the parked rAF so the board repaints. */
  const edgeHasEventRef = useRef(edgeHasEvent);
  edgeHasEventRef.current = edgeHasEvent;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const css = getComputedStyle(canvas);
    const paintColors = {
      accent: css.getPropertyValue("--accent").trim() || "#5b8dee",
      fg: css.getPropertyValue("--foreground").trim() || "#e6e8eb",
      muted: css.getPropertyValue("--muted").trim() || "#8b93a1",
      sep: css.getPropertyValue("--separator").trim() || "#1d2126",
      edge: css.getPropertyValue("--edge").trim() || "#6b7688",
      border: css.getPropertyValue("--border").trim() || "#262b31",
      surface: css.getPropertyValue("--surface").trim() || "#14171b",
    };

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
    // seed a brand-new node near what it connects to.
    const neighborsOf = new Map<string, string[]>();
    for (const e of graph.edges) {
      (neighborsOf.get(e.from) ?? neighborsOf.set(e.from, []).get(e.from)!).push(e.to);
      (neighborsOf.get(e.to) ?? neighborsOf.set(e.to, []).get(e.to)!).push(e.from);
    }

    const nodes: Sim[] = graph.nodes.map((n, i) => {
      const prev = prevPositions.get(n.id);
      if (prev) return { ...n, x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy, deg: 0 };
      const seed = seedPosition(neighborsOf.get(n.id) ?? [], prevPositions, {
        x: Math.cos(i) * 260 + jitterFromId(n.id) * 30,
        y: Math.sin(i) * 260 + jitterFromId(n.id, "y") * 30,
      });
      return { ...n, x: seed.x, y: seed.y, vx: 0, vy: 0, deg: 0 };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    // `{ source, target }` is what forceLink requires, so it is what the whole effect uses; the
    // wire says `from`/`to`. An edge naming a card the graph does not hold is dropped rather than
    // crashing the layout -- the fixtures assert offDeckReasons is 0, this is the runtime half.
    const links: SimLink[] = graph.edges
      .map((e) => ({ source: byId.get(e.from), target: byId.get(e.to), weight: e.weight }))
      .filter((l): l is SimLink => Boolean(l.source && l.target));
    // WHICH TAGS EACH DRAWN EDGE CARRIES, keyed the way `flowEdgeByPair` already keys. `SimLink`
    // deliberately does not carry them: it is the SIMULATION's type and the force layout has no
    // business knowing what a mechanism is. Graph-scoped, so it is rebuilt when the board's edges
    // change and never per frame.
    const tagsByPair = new Map<string, string[]>();
    for (const e of graph.edges) tagsByPair.set(`${e.from}>${e.to}`, e.tags);
    // Sum of weight over every link touching a node -- NOT `deg` (a partner COUNT) a few lines
    // below. An edge is binary but synergy has magnitude (CLAUDE.md): a card with six weak partners
    // must not outrank one with two strong ones for a label. Built once here, read every frame by
    // the label pass through the draw() closure below, never recomputed per frame.
    const weightedDegree = new Map<string, number>();
    for (const l of links) {
      l.source.deg++; l.target.deg++;
      weightedDegree.set(l.source.id, (weightedDegree.get(l.source.id) ?? 0) + l.weight);
      weightedDegree.set(l.target.id, (weightedDegree.get(l.target.id) ?? 0) + l.weight);
    }
    const maxWeight = links.reduce((m, l) => Math.max(m, l.weight), 0);

    const simulation = createBoardSimulation({ nodes, links, params });
    // A from-scratch graph gets full energy to organize; a graph that already has settled
    // positions only needs enough to let what changed find its place -- and how much that is, is
    // measured rather than guessed now. See EDIT_REHEAT_ALPHA (board-force.ts) for the table.
    //
    // It equals FIT_SETTLE_ALPHA, so a graph change now re-frames the camera on its FIRST tick
    // instead of ~6 s later. That is the better of the two behaviours (a fit that arrives seconds
    // after the change reads as the board moving on its own) and it is a coincidence of two
    // separately-chosen numbers, so do not couple them: the fit's threshold answers "settled
    // enough to frame", this answers "energy enough to admit a change".
    simulation.alpha(isFirstLayout ? 1 : EDIT_REHEAT_ALPHA);

    // Measurement hook for the readability judge (and for anyone debugging layout in a console):
    // the live simulation state, which is otherwise sealed inside this closure. Read-only snapshot,
    // rebuilt per call. Not dev-gated -- it is a few bytes, it ships no behaviour, and a metric you
    // can only collect in a special build is a metric nobody collects.
    //
    // `edges` rides along as a property on the returned array (not a change to the array's own
    // shape), the way `tallies` and `circles` did for the room board: the drawing-quality metrics
    // (board-quality.ts) need each edge's target distance, which the node list alone cannot say.
    (canvas as unknown as { __graphProbe?: () => unknown }).__graphProbe = () =>
      Object.assign(
        nodes.map((n) => ({
          id: n.id, x: n.x, y: n.y, r: nodeRadius(), deg: n.deg,
          roles: n.roles ?? null, artCrop: n.artCrop ?? null,
        })),
        {
          // camRef.current, read directly rather than through `cam` below: the mode buttons write
          // camRef.current.z from outside this effect, and this closure must see that write on its
          // next call rather than a value frozen when the probe was first built.
          camZ: camRef.current.z,
          edges: links.map((l) => ({
            from: l.source.id, to: l.target.id, weight: l.weight,
            target: linkDistanceFor(l.weight, maxWeight),
          })),
          // Exposes the REAL `toWorld` closure (declared further down this effect -- fine, this
          // outer function isn't invoked until well after the whole effect body has run) rather
          // than a reimplementation, so a test exercises the exact screen<->world math the pointer
          // handlers use. The zoom-origin defect (draw()'s canvas-centre origin vs d3-zoom's
          // top-left one) was invisible to every prior test because nothing could ask "what world
          // point is under this client point" without reading real canvas pixels.
          toWorld,
          // Test-only entry into the ACTUAL gesture wiring behind zoomBehavior's "end" handler
          // below -- not a reimplementation, the exact same `zoomBehavior.transform` call
          // `jumpZoom` already makes in production, just with a 4th `event` argument. d3-zoom's own
          // `zoom.transform` attaches whatever it's given as `sourceEvent` via
          // `Gesture.prototype.event(event)` -- a plain property write, no WebIDL Event
          // construction involved -- so a literal object like `{type: "mouseup", clientX, clientY}`
          // sidesteps the jsdom `view` brand check that blocks a real mousedown-driven gesture
          // entirely (see GraphView.test.tsx). `transform` defaults to the camera's own current
          // value -- a no-op move, i.e. "this gesture did not pan" -- so a caller only has to say
          // where the pointer was and what kind of event ended the gesture.
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
    // Reassigned once zoomBehavior/selection exist (below) -- same reason jumpZoomRef starts as a
    // no-op and is filled in later: it closes over consts declared further down, which a closure
    // capturing them directly would hit in their temporal dead zone. Effect-local rather than a
    // ref: nothing outside this effect needs to call it. The frame loop's first call is made AFTER
    // the real assignment (see `loop()` below), so no tick ever runs against this stub -- a claim
    // this comment made for months while `loop()` actually sat ABOVE the assignment. It was true in
    // effect only because alpha never satisfied the fit condition on the first synchronous call;
    // EDIT_REHEAT_ALPHA made it false and the StrictMode fit test caught it (roadmap H9).
    let fitToView = () => {};

    const artLoader = artLoaderRef.current!;

    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = paintColors.surface;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // cam.x/y are d3-zoom's own translate, top-left-anchored -- the SAME convention
      // `pointer(event)` (and therefore every anchor computation d3-zoom does internally) uses.
      // This used to add dim.w/2 + dim.h/2 here to draw a centre-anchored board, which put the
      // renderer's origin at the canvas CENTRE while d3-zoom kept anchoring wheel/drag at the
      // TOP-LEFT -- the two disagreed by exactly half the canvas, so every zoom recentred a
      // quarter-viewport away from the cursor. Centring now happens once, at the initial seed
      // transform below, by baking dim.w/2 + dim.h/2 into cam.x/y themselves.
      ctx.setTransform(cam.z * dim.dpr, 0, 0, cam.z * dim.dpr, cam.x * dim.dpr, cam.y * dim.dpr);

      // One stroke per edge rather than one path for all of them: width carries weight now, and a
      // single batched path can only have one width. ~200 edges a frame.
      const activeFlow = flowRef.current;
      // Built once per draw, not per edge: an O(links) `.find` over `activeFlow.edges` inside the
      // loop below was O(links x flowEdges) every frame. Keyed `from>to` -- flow edges are already
      // direction-pure, so there is never a `to>from` collision to worry about.
      const flowEdgeByPair = new Map<string, FlowEdge>();
      if (activeFlow) {
        for (const fe of activeFlow.edges) flowEdgeByPair.set(`${fe.from}>${fe.to}`, fe);
      }
      // Direction as motion: flow edges are dashed, and the pattern crawls from producer to
      // consumer. Read ONCE per frame, not per edge -- every edge in a frame must share a phase or
      // the flow reads as noise instead of as one current.
      //
      // Wall-clock, not a frame counter: a per-frame increment would crawl twice as fast on a 120Hz
      // display as on a 60Hz one. Modulo one dash cycle keeps the number small and changes nothing
      // visible -- the pattern repeats every `on + off` pixels by definition.
      //
      // prefers-reduced-motion freezes the phase at 0. The dashes stay (a static dash is harmless)
      // but they carry no direction, so those readers fall back to the flow legend's wording. That
      // gap is recorded in the design doc; closing it means arrowheads, which are a separate item.
      // Hoisted above the EDGE pass -- it used to be built inside the label pass, which is the last
      // thing draw() does. Both passes read the same set now, so a hovered card's edges, its
      // partners and their labels cannot disagree about what "one hop" means.
      const hoveredId = hoveredIdRef.current;
      const hoveredSet = hoveredId
        ? new Set([hoveredId, ...(neighborsOf.get(hoveredId) ?? [])])
        : new Set<string>();
      // A CLICK OUTRANKS A HOVER, ALWAYS. The flow is what the reader deliberately asked for; the
      // hover is where their pointer happens to be. Running both at once would dim the flow's own
      // cards whenever the pointer sat over an unrelated one.
      const hoverActive = hoveredId !== null && !activeFlow;
      const stillMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
      const dashCycle = FLOW_DASH.on + FLOW_DASH.off;
      const crawl = stillMotion ? 0 : (performance.now() / 1000 * FLOW_DASH.speed) % dashCycle;
      for (const l of links) {
        const fe = flowEdgeByPair.get(`${l.source.id}>${l.target.id}`);
        // An edge in the flow takes its direction's hue at full opacity; everything else keeps the
        // neutral stroke and drops to the dim alpha, so the flow reads against the rest of the deck.
        // Outside a flow, opacity carries WEIGHT (edgeAlpha) -- the flat 0.15 stays for the dimmed
        // background because a dimmed edge is scenery, and re-ranking scenery by weight would make
        // the strongest UNSELECTED edge compete with the flow the reader asked for.
        // A hovered card's own edges take the flow's direction hues -- the same two colours the
        // legend already names, so hover and click say the same thing in the same language.
        const hoverDir = hoverActive && l.source.id === hoveredId ? "down"
          : hoverActive && l.target.id === hoveredId ? "up"
          : null;
        // AN EDGE THAT DOES NOT CARRY THE TRACED EVENT IS SCENERY, and it outranks every other
        // alpha rule here: the reader named one mechanism, so nothing else on the board may present
        // itself as the answer — not a hover, and not the direction hues of a flow that walked only
        // matching edges anyway. Dimmed rather than hidden, the same grammar the search uses, so the
        // deck keeps its shape and the traced chain reads AGAINST it rather than in a vacuum.
        const edgeTags = tagsByPair.get(`${l.source.id}>${l.target.id}`) ?? [];
        const offEvent = !edgeHasEventRef.current({ tags: edgeTags });
        // WHICH MECHANISM THIS EDGE IS, and whether the reader has isolated a different one. Hue
        // used to mean up/down and nothing else, so a forty-edge flow was one mesh; it means the
        // EVENT now, and direction moved to the dash crawl below.
        const edgeVerbs = edgeTags.map((t) => t.split(":")[0]);
        const flowVerb = fe ? edgeVerbs.find((v) => flowHueRef.current.has(v)) : undefined;
        const focus = flowFocusRef.current;
        const offFocus = fe !== undefined && focus !== null && !edgeVerbs.includes(focus);
        ctx.globalAlpha = offEvent ? 0.06
          : offFocus ? 0.12
          : fe ? 1
          : activeFlow ? 0.15
          : hoverDir ? 1
          : hoverActive ? edgeAlpha(l.weight, maxWeight) * HOVER_EDGE_DIM
          : edgeAlpha(l.weight, maxWeight);
        ctx.strokeStyle = offEvent || offFocus ? paintColors.edge
          // The event's hue, falling back to the direction pair only when this edge carries no verb
          // the legend named -- which is the >7-event tail the legend calls "everything else".
          : fe ? (flowVerb ? flowHueRef.current.get(flowVerb)! : OVERFLOW_HUE)
          : hoverDir ? FLOW_HUE[hoverDir]
          : paintColors.edge;
        ctx.lineWidth = edgeWidth(l.weight, maxWeight) / cam.z;
        // Sticky context state: the else branch is not optional. Without it the pattern set by the
        // last flow edge would dash every rim, border and card frame drawn after this loop.
        if (fe && !offEvent && !offFocus) {
          ctx.setLineDash([FLOW_DASH.on / cam.z, FLOW_DASH.off / cam.z]);
          // DIRECTION IS THE CRAWL NOW THAT HUE CARRIES THE MECHANISM. Dashes travel AWAY from the
          // clicked card on what it feeds and TOWARD it on what feeds it, so the two channels are
          // independent: colour says which event, motion says which way. `FLOW_DASH`'s own comment
          // already called the motion the encoding -- it just was not being used as one.
          ctx.lineDashOffset = (fe.dir === "down" ? -crawl : crawl) / cam.z;
        } else {
          ctx.setLineDash([]);
        }
        // TRIMMED TO THE RIM, NOT DRAWN TO THE CENTRE. A centre-to-centre line runs UNDER both
        // discs, and once the discs carry card art the line reads as sliding beneath the card and
        // out the other side — owner-reported, 2026-08-27. It also makes an edge that merely PASSES
        // a third card look like it terminates there. Ending the stroke at the rim leaves the
        // relationship legible and the disc unbroken.
        //
        // ART_RADIUS is the disc, which is what the miniature and dot modes draw. CARD mode draws a
        // larger rectangle, so a line still enters the card frame there — that view is one card
        // filling the screen with its neighbours off it, so the case is cosmetic rather than the one
        // reported. Stated rather than silently approximated.
        const ex = l.target.x - l.source.x;
        const ey = l.target.y - l.source.y;
        const elen = Math.hypot(ex, ey);
        // Two overlapping discs have no visible span between them; drawing anyway would paint a
        // backwards stub poking out of both.
        if (elen <= ART_RADIUS * 2) continue;
        const tx = ex / elen;
        const ty = ey / elen;
        ctx.beginPath();
        ctx.moveTo(l.source.x + tx * ART_RADIUS, l.source.y + ty * ART_RADIUS);
        ctx.lineTo(l.target.x - tx * ART_RADIUS, l.target.y - ty * ART_RADIUS);
        ctx.stroke();
        // DIRECTION MUST SURVIVE A STILL FRAME. Hue carries the MECHANISM now, so the crawl became
        // the only direction channel -- and `stillMotion` zeroes the crawl under
        // `prefers-reduced-motion`, which left those readers with no direction encoding at all. It
        // is also invisible in a screenshot, and the task-5 brief already recorded a blind judge
        // unable to tell producer from consumer from the hues alone.
        //
        // An arrowhead is the conventional answer for a directed graph and is static by
        // construction. Drawn only on a flow edge: the resting board is undirected to the eye and
        // ninety arrowheads would be noise on top of the mesh this whole change exists to thin.
        if (fe && !offEvent && !offFocus) {
          const hx = l.target.x - tx * ART_RADIUS;
          const hy = l.target.y - ty * ART_RADIUS;
          const head = 5 / cam.z;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(hx - tx * head - ty * head * 0.55, hy - ty * head + tx * head * 0.55);
          ctx.lineTo(hx, hy);
          ctx.lineTo(hx - tx * head + ty * head * 0.55, hy - ty * head - tx * head * 0.55);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);

      // A search dims what does not match rather than hiding it, so the deck keeps its shape and
      // you can see WHERE the match sits. `matchIds` null means no active search: dim nothing.
      // Read through the ref (see matchesRef above), never `matches` directly -- this closure is
      // rebuilt only when the effect re-runs, and the effect must not re-run on every keystroke.
      const matchIds = matchesRef.current;
      const mode = renderModeFor(cam.z);
      const cardW = CARD_W, cardH = CARD_H;
      // Cards drawn as a loading/no-art placeholder this frame. Card mode suppresses name labels,
      // because the card's own art prints the name — but a placeholder is a blank coloured
      // rectangle, so those keep theirs or nothing on screen names them. Collected here rather than
      // recomputed in the label pass so "did this node draw art?" has ONE answer per frame.
      const placeholderIds = new Set<string>();
      for (const n of nodes) {
        // See EDGELESS_ALPHA's comment. Two things narrow when the demotion actually applies:
        // a search match wins over it (if the user went looking for this exact card, it must show
        // at full strength even though it's edgeless), and CARD mode is left alone -- that view
        // only happens zoomed in on one card at a time, where there is no neighbouring dot to
        // mistake it for a relationship with; the proximity misread this exists to prevent is a
        // miniature-mode phenomenon.
        const searchDim = matchIds && !matchIds.has(n.id);
        const searchHit = matchIds && matchIds.has(n.id);
        const demote = n.deg === 0 && mode !== "card" && !searchHit;
        // FLOW OVERRIDES THE RIM, BUT ONLY ON CARDS IN THE FLOW (owner's call). Computed here,
        // ahead of the alpha decision, so a card outside the flow dims as a whole -- art included,
        // not just its rim -- rather than the art staying bright while only the ring goes faint.
        const flowNode = activeFlow?.nodes.get(n.id);
        const isRoot = activeFlow?.root === n.id;
        // A SEARCH HIT OUTRANKS THE FLOW DIM (roadmap H3). `searchHit` guarded only `demote`, so a
        // card the user went looking for, sitting outside the selected card's flow, fell into the
        // flow branch and dimmed to 0.15 -- accent ring included, since the ring below is drawn
        // under this same alpha. The board then reported "2 MATCHES" and showed the reader nothing.
        // Precedence, in words: a non-match under an active search is scenery; a MATCH is what was
        // asked for and is never dimmed by anything; only then does the flow decide.
        ctx.globalAlpha = searchDim ? 0.15
          : searchHit ? 1
          : activeFlow && !flowNode && !isRoot ? 0.15
          : hoverActive && !hoveredSet.has(n.id) ? HOVER_NODE_DIM
          : demote ? EDGELESS_ALPHA : 1;
        // The draw-time radius for this node's circle/rim/clip -- ART_RADIUS everywhere except a
        // demoted edgeless card, which draws visibly smaller as well as fainter.
        // pickAt still hit-tests at the FULL radius: board-force.ts's nodeRadius comment says every
        // consumer reads one function so painted and simulated size cannot drift, and this is a
        // knowing, one-way exception. A demoted card's click target stays the size of the card it
        // is, which is a bigger target than its dot -- the failure mode that would matter (a dead
        // zone under a visible card) cannot happen this way round.
        const r = demote ? ART_RADIUS * EDGELESS_RADIUS_SCALE : ART_RADIUS;

        // Render is a function of the camera, not a stored mode (card-node.ts's doc comment) --
        // reading cam.z here means the scroll wheel and the mode buttons can never disagree
        // about what's on screen. Card mode's source is a DIFFERENT cache key (cardImageUrl
        // rewrites the path segment to a bigger size), so switching modes cold is a real fetch,
        // not just a bigger draw of what miniature mode already had loaded.
        const src = mode === "card" && n.artCrop ? cardImageUrl(n.artCrop) : n.artCrop;
        // WARM THE FULL IMAGE OF WHAT IS ON SCREEN while zooming in, not just what is hovered.
        //
        // The report-level warm-up fetches `art_crop` (the disc); card mode draws `/normal/` (the
        // whole card). Those are DIFFERENT URLs, so a warm board still had no card image at all and
        // zooming in started the fetch from cold — reported after the first attempt at this. Hover
        // alone could not cover it: a wheel zoom need not move the pointer, so `pointermove` may
        // never fire, and when it does it fires on arrival with no lead time.
        //
        // Bounded to the viewport, which is what makes this affordable: warming all 95 is the
        // ~7.5MB that got the cropped-disc approach rejected, while at PREFETCH_Z the screen holds
        // a couple of dozen cards and fewer the further in you go. Not urgent — this is speculative,
        // and the card actually being drawn in card mode below jumps ahead of it.
        if (mode !== "card" && n.artCrop && shouldPrefetchCard(cam.z)
          && isOnScreen(n, cam, dim, ART_RADIUS * cam.z)) {
          artLoader.request(cardImageUrl(n.artCrop));
        }
        const img = src ? artLoader.get(src) : undefined;
        // A node stands for every copy of its card. Draw the stack behind the art so nine
        // Relentless Rats do not read as one Rat, and badge the count.
        const copies = n.copies ?? 1;
        if (copies > 1) {
          ctx.strokeStyle = paintColors.border;
          ctx.lineWidth = 1 / cam.z;
          for (const offset of [4, 2]) {
            if (mode === "card") {
              ctx.strokeRect(n.x - cardW / 2 + offset, n.y - cardH / 2 - offset, cardW, cardH);
            } else {
              ctx.beginPath();
              ctx.arc(n.x + offset, n.y - offset, r, 0, TAU);
              ctx.stroke();
            }
          }
        }

        // An edgeless card never carries its paint-mode colour -- suppressing the hue is what
        // kills the "matching ring colour" cue the judge actually used, not just fading it. This
        // reuses the SAME fallback rendering the code below already has for a card with no value
        // under the current facet (a plain muted-border ring/box, no fill), rather than inventing
        // a second "nothing to show" path.
        const hues = demote ? [] : (huesRef.current.get(n.id) ?? []);

        // Everything else keeps its paint-mode rim, dimmed: the paint mode answers "what are these
        // cards", and a click asking "what does this feed" is no reason to stop answering that
        // everywhere else. `hues` feeds BOTH the rim arcs and card mode's bottom bars, so overriding
        // it here is the single insertion point for the whole node paint. (`flowNode`/`isRoot` were
        // computed earlier, alongside the alpha decision -- see above.)
        const flowHues = flowNode
          ? [
              ...(flowNode.upstreamDepth !== undefined ? [FLOW_HUE.up] : []),
              ...(flowNode.downstreamDepth !== undefined ? [FLOW_HUE.down] : []),
            ]
          : [];
        const paintHuesForNode = flowNode ? flowHues : hues;

        if (mode === "card" && img instanceof HTMLImageElement && img.naturalWidth > 0) {
          // The full card, not a cover-fit crop: a 5:7 box centred on the node. Card mode only
          // happens zoomed in, where neighbours are hundreds of screen px apart.
          ctx.drawImage(img, n.x - cardW / 2, n.y - cardH / 2, cardW, cardH);
        } else if (img instanceof HTMLImageElement && img.naturalWidth > 0 && img.naturalHeight > 0) {
          // Scryfall's art_crop is landscape (~626x457); the 5-arg drawImage would squash it into
          // this square node. Cover-fit instead: crop a centred square out of the source (the
          // shorter side) and draw that into the node -- same trick as CSS `object-fit: cover`.
          // Guard the source dims: a truthy naturalWidth/Height of 0 (or NaN) would hand drawImage
          // a zero-size source rect, which throws and would kill the whole animation loop.
          const sw = img.naturalWidth, sh = img.naturalHeight, s = Math.min(sw, sh);
          ctx.save();
          ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, TAU); ctx.clip();
          ctx.drawImage(img, (sw - s) / 2, (sh - s) / 2, s, s,
            n.x - r, n.y - r, r * 2, r * 2);
          ctx.restore();
        } else {
          // Covers both "no art at all" and "card mode wants an image that hasn't loaded yet" -- a
          // blank node is worse than a small one, so this always requests `src` (whichever size the
          // current mode wants) and draws a placeholder rather than nothing. The FILL is the point:
          // it is the only thing on screen at the moment the user is zoomed in and looking at
          // nothing else, so it has to read as a solid loading signal. Filled in the card's own
          // paint hue, so a deck whose art has not landed is still readable by facet.
          // URGENT in card mode: only a handful of cards are on screen there and one of them is the
          // card the user zoomed in to read, so it must not queue behind the other 90 discs.
          if (src) artLoader.request(src, mode === "card");
          placeholderIds.add(n.id);
          ctx.fillStyle = hues[0] ?? paintColors.muted;
          if (mode === "card") {
            ctx.fillRect(n.x - cardW / 2, n.y - cardH / 2, cardW, cardH);
          } else {
            ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, TAU); ctx.fill();
          }
        }

        // What this card IS, under the current paint mode. Drawn for both the art and the fallback
        // branch: a card whose art failed to load must not lose its facet signal along with its
        // picture. Hue rides the rim, never a fill over the art -- a translucent wash over this
        // surface collapses toward gray (measured) and stops separating.
        if (mode === "card") {
          // Equal-width bars along the card's bottom edge. Card mode paints a rectangle, so there
          // is no rim to stroke arcs onto.
          const barW = cardW / Math.max(paintHuesForNode.length, 1);
          paintHuesForNode.forEach((hue, i) => {
            ctx.fillStyle = hue;
            ctx.fillRect(n.x - cardW / 2 + i * barW, n.y + cardH / 2 - BAR_H, barW, BAR_H);
          });
          if (paintHuesForNode.length === 0) {
            ctx.lineWidth = 1 / cam.z;
            ctx.strokeStyle = paintColors.border;
            ctx.strokeRect(n.x - cardW / 2, n.y - cardH / 2, cardW, cardH);
          }
        } else {
          ctx.lineWidth = 2.5 / cam.z;
          for (const arc of rimArcs(paintHuesForNode)) {
            ctx.strokeStyle = arc.hue;
            ctx.beginPath();
            ctx.arc(n.x, n.y, r, arc.from, arc.to);
            ctx.stroke();
          }
          if (paintHuesForNode.length === 0) {
            ctx.lineWidth = 1 / cam.z;
            ctx.strokeStyle = paintColors.border;
            ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, TAU); ctx.stroke();
          }
        }

        // The card you clicked, in neutral: it must not compete with the two direction hues, and
        // "this is the thing you asked about" is a different claim from "this produces/consumes".
        if (isRoot) {
          ctx.lineWidth = 2.5 / cam.z;
          ctx.strokeStyle = paintColors.fg;
          ctx.beginPath();
          if (mode === "card") ctx.strokeRect(n.x - cardW / 2 - 3, n.y - cardH / 2 - 3, cardW + 6, cardH + 6);
          else ctx.arc(n.x, n.y, r + 3, 0, TAU);
          ctx.stroke();
        }

        if (matchIds?.has(n.id)) {
          ctx.lineWidth = 2.5 / cam.z;
          ctx.strokeStyle = paintColors.accent;
          if (mode === "card") {
            ctx.strokeRect(n.x - cardW / 2 - 3, n.y - cardH / 2 - 3, cardW + 6, cardH + 6);
          } else {
            ctx.beginPath(); ctx.arc(n.x, n.y, r + 3, 0, TAU); ctx.stroke();
          }
        }

        if (copies > 1) {
          ctx.font = `500 ${10 / cam.z}px "JetBrains Mono", ui-monospace, monospace`;
          ctx.textAlign = "center";
          ctx.fillStyle = paintColors.fg;
          ctx.fillText(`×${copies}`, n.x, n.y + ART_RADIUS + 11 / cam.z);
        }

        // A TOKEN IS NOT A CARD, AND THE BOARD HAS TO SAY SO -- it can carry the same name as a real
        // card sitting next to it (92 corpus token names are also a card). Dashed rim: the node is a
        // permanent the deck MAKES, not one of the 99 it holds. The word goes in the copies badge's
        // slot, which is free here -- a token is always exactly one node.
        if (n.isToken) {
          ctx.save();
          ctx.setLineDash([4 / cam.z, 3 / cam.z]);
          ctx.lineWidth = 1.5 / cam.z;
          ctx.strokeStyle = paintColors.muted;
          ctx.beginPath();
          if (mode === "card") ctx.strokeRect(n.x - cardW / 2 - 3, n.y - cardH / 2 - 3, cardW + 6, cardH + 6);
          else ctx.arc(n.x, n.y, r + 3, 0, TAU);
          ctx.stroke();
          ctx.restore();
          ctx.font = `500 ${10 / cam.z}px "JetBrains Mono", ui-monospace, monospace`;
          ctx.textAlign = "center";
          ctx.fillStyle = paintColors.muted;
          ctx.fillText("token", n.x, n.y + ART_RADIUS + 11 / cam.z);
        }
      }
      // Canvas state is global and persistent, so a search left dimming on would leak into the
      // next frame's first edge.
      ctx.globalAlpha = 1;

      // SEMANTIC-ZOOM LABELS -- pure paint (labels.ts). No node's x/y/radius is ever read FROM
      // this pass, only INTO it: overlap is resolved in screen space, after the fact, and the
      // result is a draw decision only. Below the zoom floor the candidate set itself narrows to
      // commanders and the hovered neighbourhood, rather than asking placeLabels to reject 90-odd
      // boxes crammed into a few screen px every frame.
      // A FLOOR AND, SINCE 2026-08-14, A CEILING. Labels used to start above LABEL_ZOOM_FLOOR and
      // never stop, so from CARD_MODE_Z (4) to MAX_Z (8) a name was painted over a card whose own
      // art prints that name larger and better. Above the ceiling only the cards with NO art drawn
      // keep a label: a placeholder is a blank coloured rectangle, and suppressing its name would
      // leave nothing on screen identifying it. Paint only — no candidate set has ever fed layout.
      const candidates = labelCandidates(nodes, cam.z, {
        zoomFloor: LABEL_ZOOM_FLOOR,
        cardModeZoom: CARD_MODE_Z,
        eligibleBelowFloor: new Set([...commandersRef.current, ...hoveredSet]),
        placeholders: placeholderIds,
      });
      if (candidates.length > 0) {
        // World-unit font size so it renders at a constant LABEL_PX screen px -- the formula the
        // deleted room labels also used (roomFontPx); the defect was never the formula, only that
        // its measured box got fed back into layout. ctx.measureText here returns a WORLD-unit
        // width (it is unaffected by the active transform's scale, only by the font size that
        // transform will later stretch), so it is multiplied by cam.z below to land in screen
        // space -- an unconverted world box compared as though it were screen px is the exact bug
        // that got labels deleted the first time (see this task's brief).
        ctx.font = `500 ${LABEL_PX / cam.z}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.fillStyle = paintColors.fg;
        const order = labelPriority(candidates, weightedDegree, commandersRef.current, hoveredSet);
        // TWO SLOTS PER LABEL, above then below -- see placeLabels. `mode === "card"` uses the
        // card's own half-height, so a label clears the printed card rather than the disc that is
        // not being drawn.
        const nodeHalfH = (mode === "card" ? cardH / 2 : nodeRadius()) * cam.z;
        const boxes = order.map((id) => {
          const n = byId.get(id)!;
          const wScreen = ctx.measureText(n.label).width * cam.z;
          const sx = n.x * cam.z + cam.x, sy = n.y * cam.z + cam.y;
          const common = {
            id,
            x: sx - wScreen / 2 - LABEL_GAP,
            w: wScreen + LABEL_GAP * 2,
            h: LABEL_PX + LABEL_GAP * 2,
          };
          return [
            { ...common, y: sy - nodeHalfH - LABEL_PX - LABEL_GAP },
            { ...common, y: sy + nodeHalfH + LABEL_GAP },
          ];
        });
        // THE NODES ARE OBSTACLES TOO (roadmap H7). Every node on the board, at the size it
        // actually paints -- a disc of nodeRadius() in miniature, the full CARD_W x CARD_H rectangle
        // in card mode -- so a label can no longer be printed across a neighbour's art. Built from
        // `nodes` rather than from `candidates`: a label must clear every node it could cover, and
        // at a zoom below LABEL_ZOOM_FLOOR most nodes carry no label of their own while still being
        // very much in the way.
        const halfW = (mode === "card" ? cardW : nodeRadius() * 2) * cam.z / 2;
        const nodeBoxes = nodes.map((n) => ({
          id: n.id,
          x: n.x * cam.z + cam.x - halfW,
          y: n.y * cam.z + cam.y - nodeHalfH,
          w: halfW * 2,
          h: nodeHalfH * 2,
        }));
        // Same dimming rule the node pass uses a few lines up, and the same reason: a search keeps
        // the deck's shape rather than hiding what doesn't match, so a matching card's NAME must
        // read as clearly as its ring does. `matchIds` (not `matches`) -- see the node pass's own
        // comment on why this reads the ref.
        for (const { id, slot } of placeLabels(boxes, nodeBoxes)) {
          const n = byId.get(id)!;
          // An edgeless card's NAME is demoted with its disc. Without this the demotion half-lands:
          // a faint, shrunken, colourless dot under a full-brightness label, which is a card
          // ANNOUNCING itself while the drawing says it is not participating. `demote` from the node
          // pass is recomputed rather than shared -- that pass runs per node, this one per SURVIVING
          // label, so sharing it would mean threading a flag through placeLabels for no gain.
          const labelDemote = n.deg === 0 && (!matchIds || !matchIds.has(id));
          // Same flow condition the node pass applies to the disc a few lines up (see its comment)
          // -- without this a non-flow card kept a full-brightness NAME over a 0.15 disc, which is
          // exactly the half-landed demotion that comment warns about.
          const labelFlowNode = activeFlow?.nodes.get(id);
          const labelIsRoot = activeFlow?.root === id;
          ctx.globalAlpha = matchIds && !matchIds.has(id) ? 0.15
            : activeFlow && !labelFlowNode && !labelIsRoot ? 0.15
            : labelDemote ? EDGELESS_ALPHA : 1;
          // Slot 1 is the below-the-node fallback: the text baseline sits under the node rather
          // than over it, so the drawn position is the one placeLabels actually reserved.
          const halfWorld = mode === "card" ? cardH / 2 : nodeRadius();
          ctx.fillText(n.label, n.x, slot === 0
            ? n.y - halfWorld - 4 / cam.z
            : n.y + halfWorld + (LABEL_PX + 2) / cam.z);
        }
        // Canvas state is global and persistent (draw()'s own reset a few lines up already makes
        // this mistake impossible for the node pass) -- a search left dimming on here would leak
        // into next frame's background wipe.
        ctx.globalAlpha = 1;
      }
    };

    // Fit once per DECK, tracked by which graph object was framed rather than by whether this run
    // inherited positions. `!isFirstLayout` looked equivalent and was not: it means "some earlier
    // run of this effect left positions behind", which is also true of a run that was torn down
    // BEFORE it ever fitted. React.StrictMode does exactly that in dev -- mount, cleanup, mount --
    // and the fit takes ~696 ticks (about 12 s) to fire, so the first run always died first and the
    // second started with fitted = true. Measured in the browser: the camera never moved, 74 of 84
    // cards on screen at zoom 1; with StrictMode off, zoom 0.235 and 84 of 84. Every jsdom test
    // passed throughout, because they drive alpha down by hand instead of letting it decay.
    let fitted = fittedGraphRef.current === graph;
    const loop = () => {
      // Rescheduled FIRST, so no early return below can end the loop. See `invalidate`'s comment:
      // the rAF is deliberately immortal, because a missed wake is a frozen board.
      raf = requestAnimationFrame(loop);
      // The two CONTINUOUS drivers, neither of which sets the dirty flag because neither is an
      // event: the simulation still moving, and the flow's crawling dash (`FLOW_DASH.speed`), which
      // animates off `performance.now()` and so needs a frame every frame while a flow is open.
      // `prefers-reduced-motion` freezes the crawl, and a frozen crawl is not a driver.
      const moving = simulation.alpha() > PARK_ALPHA;
      const crawling = flowRef.current !== null
        && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches !== true;
      if (!dirtyRef.current && !moving && !crawling) return;
      dirtyRef.current = false;
      // Only while moving: ticking a settled simulation advances its alpha decay for nothing, and
      // the fit below is reached BY those ticks, so it cannot be starved by this gate.
      if (moving) {
        simulation.tick();
        // <=, not <: an exactly-0.05 alpha is settled enough, and floating-point decay can land on
        // it without ever going strictly below.
        if (!fitted && simulation.alpha() <= FIT_SETTLE_ALPHA) {
          fitToView();
          fitted = true;
          fittedGraphRef.current = graph;
        }
      }
      draw();
    };

    // A resize updates the canvas's own backing-store size, then -- if the FIT still owns the
    // camera (cameraOwnedByUserRef is not this graph) -- reframes it for the new dimensions. A
    // camera the user deliberately moved is left exactly alone, which is what the original comment
    // here protected; what it got wrong is that a camera the FIT last set is stale the instant the
    // canvas changes size, and the normal way this board is viewed is exactly that: open small,
    // then go fullscreen. Measured in the browser (sorin fixture): zoom stayed 0.538 across an
    // in-tab-pane (1534x518) -> fullscreen (1598x894) resize, where 1.053 was what actually fit --
    // 0.538 is also below LABEL_ZOOM_FLOOR (0.6), so the stale camera cost card names too.
    //
    // FIX ROUND 2: watched via ResizeObserver on the canvas itself, not a window "resize" listener.
    // Entering ELEMENT fullscreen -- the fullscreen button on this board, the one transition anyone
    // actually takes to read an 84-node graph -- resizes the canvas's own box without ever firing a
    // window resize event in Chrome (measured live, same session as the numbers above: zoom stuck
    // at 0.570 through fullscreen entry, 1598x894 canvas, labels still off; a genuine window resize
    // right after DID refit, to 0.709). ResizeObserver fires for any layout change that resizes the
    // canvas's content box -- fullscreen, a window resize, a sidebar collapsing -- so it replaces
    // the window listener rather than joining it as a second special case.
    const onResize = () => {
      dim = size();
      if (cameraOwnedByUserRef.current !== graph) fitToView();
    };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(canvas);

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

    const pickAt = (wx: number, wy: number): Sim | null => {
      // Card mode paints a 5:7 RECTANGLE (CARD_W x CARD_H, sized off the settled spacing in
      // board-force.ts -- see draw()'s `mode === "card"` branch), not the disc nodeRadius() reports
      // for the sim/miniature paint.
      // Hit-testing the inscribed circle there left the top/bottom bands and all four corners dead
      // to the pointer. Computed once per pick rather than per node: it depends only on cam.z.
      const cardMode = renderModeFor(cam.z) === "card";
      let best: Sim | null = null, bd = Infinity;
      for (const n of nodes) {
        const dx = n.x - wx, dy = n.y - wy;
        const inside = cardMode
          ? Math.abs(dx) <= CARD_W / 2 && Math.abs(dy) <= CARD_H / 2
          : Math.hypot(dx, dy) / nodeRadius() <= 1;
        if (!inside) continue;
        const d = Math.hypot(dx, dy) / nodeRadius();
        if (d < bd) { bd = d; best = n; }
      }
      return best;
    };

    // d3-selection appears here and NOWHERE else: binding a zoom behaviour to the canvas, which is
    // already an imperative escape hatch outside React's tree. It must never drive React's DOM.
    const zoomBehavior = d3zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.15, MAX_Z])
      .on("zoom", (e: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        cam.x = e.transform.x; cam.y = e.transform.y; cam.z = e.transform.k;
        invalidate();
        // A camera the USER moved is never overwritten by the pending one-time fit, nor by a later
        // resize (onResize, above). The board takes ~696 ticks to reach FIT_SETTLE_ALPHA (see its
        // comment), which is seconds of real time, and anyone who zoomed inside that window had
        // their move silently reverted the moment the fit fired. `sourceEvent` is what separates a
        // real gesture from a programmatic one: d3 leaves it null for a programmatic
        // `zoom.transform`, so the fit's own call -- and the initial camera seed -- cannot cancel
        // themselves here, or claim `cameraOwnedByUserRef` they have no business claiming.
        if (e.sourceEvent) {
          fitted = true;
          fittedGraphRef.current = graph;
          cameraOwnedByUserRef.current = graph;
        }
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
    // Seed the behaviour with the camera the ref already holds, so a re-run of this effect does not
    // snap the view back to the origin -- cam.x/y is already an absolute, top-left-anchored
    // translate by then (the "zoom" handler above writes it straight out of d3-zoom's own
    // transform), so re-seeding with it verbatim is a no-op. Only the very FIRST layout (camRef
    // still at its useRef default of {x:0,y:0,z:1}) needs the dim.w/2 + dim.h/2 term baked in, so
    // an unmodified board opens centred under the top-left convention -- adding it on every re-run
    // would double the offset each time.
    selection.call(
      zoomBehavior.transform,
      isFirstLayout
        ? zoomIdentity.translate(dim.w / 2 + cam.x, dim.h / 2 + cam.y).scale(cam.z)
        : zoomIdentity.translate(cam.x, cam.y).scale(cam.z),
    );
    // The Card/Miniature debug buttons jump straight to a zoom level with no pointer gesture behind
    // them. Routed through zoomBehavior.transform rather than a raw `cam.z` write so the canvas's
    // own `__zoom` stays truthful for the next real gesture. `.transform()`'s own "start" event
    // still fires with the OLD transform (there is no drag here for gestureStart to protect), so it
    // is set again here, by hand, to the value this jump actually lands on -- otherwise a click
    // right after the jump would read a one-step-stale baseline and the guard below would swallow
    // it as a false drag.
    jumpZoomRef.current = (z: number) => {
      const t = zoomIdentity.translate(cam.x, cam.y).scale(z);
      selection.call(zoomBehavior.transform, t);
      gestureStart = t;
    };

    // CAMERA ONLY -- reads the settled node cloud's bounding box and moves the camera to frame it;
    // writes no node position (same rule as labels.ts). Routed through zoomBehavior.transform for
    // the same reason jumpZoomRef is, just above: a raw cam.x/y/z write would leave d3-zoom's own
    // `__zoom` bookkeeping stale, and the next wheel event would jump. gestureStart is reset here
    // too, so the click that follows a fit is not misread as the tail end of a pan.
    fitToView = () => {
      if (nodes.length === 0) return;
      // Frame the CONNECTED cluster, not the whole node cloud -- an orphan (no synergy edge at
      // all, e.g. a land) sitting far from the deck's actual synergies used to set the bounding box
      // and crush the cluster into a fraction of the frame (task-11 brief, Defect 1). Falls back to
      // every node when nothing is connected (a zero-edge deck), so the box is never taken over an
      // empty array -- that divides by nothing and leaves the camera at k = NaN.
      const connected = nodes.filter((n) => n.deg > 0);
      const framed = connected.length > 0 ? connected : nodes;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of framed) {
        minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
      }
      // Pad by a card radius on every side -- the bbox above is CENTRES, and an unpadded fit would
      // crop the outermost cards' own art in half.
      const w = maxX - minX + ART_RADIUS * 2, h = maxY - minY + ART_RADIUS * 2;
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const [zMin, zMax] = zoomBehavior.scaleExtent();
      const k = Math.max(zMin, Math.min(zMax, FIT_MARGIN * Math.min(dim.w / w, dim.h / h)));
      // Same translate-then-scale convention as the initial seed and jumpZoomRef above: the result
      // transform's x/y/k land exactly on what's passed to .translate()/.scale(), so this centres
      // (cx, cy) on the canvas at zoom k directly, with no separate re-derivation of cam.x/y.
      const t = zoomIdentity.translate(dim.w / 2 - cx * k, dim.h / 2 - cy * k).scale(k);
      selection.call(zoomBehavior.transform, t);
      gestureStart = t;
    };

    // THE FRAME LOOP STARTS HERE, AFTER fitToView IS REAL. It used to start twelve lines above this
    // assignment while claiming in its own comment to start below it, and that was harmless only
    // because the first call is SYNCHRONOUS and alpha then always exceeded FIT_SETTLE_ALPHA (a
    // fresh layout starts at 1, a reheat used to start at 0.3). Lowering the reheat to
    // EDIT_REHEAT_ALPHA (0.05) made the first synchronous call satisfy the fit condition
    // immediately, so the fit ran against the no-op stub, marked itself done, and the camera never
    // moved -- the exact StrictMode symptom the "torn down and re-run" test pins, which is what
    // caught this. A comment that describes where code SHOULD be is not a guard.
    loop();


    // THE CLICK PATH. Its body opens the inspector on the card under the pointer:
    // `pickAt(...toWorld(point))`, then the panel. That body is the ONLY part of this that was ever
    // coupled to a deleted feature (a card's back-face art, which the projection no longer carries)
    // -- it was emptied when rooms retired and refilled by the inspector. The wiring AROUND it is
    // coupled to neither, and cost three fix rounds:
    //
    // It cannot be a DOM "click" listener. d3-zoom's own mousedown handler (mousedowned in zoom.js)
    // hands panning off to d3-drag underneath it, and d3-drag's mouseupped installs a CAPTURE-PHASE
    // handler on the window that calls stopImmediatePropagation() on the very next "click" the
    // instant the pointer moved AT ALL during the gesture (g.moved, set unconditionally on the
    // first pixel -- d3-zoom exposes no clickDistance() the way d3-drag does). Capture fires before
    // bubbling ever reaches this canvas, so a "click" listener here never sees the event: only a
    // PERFECTLY stationary press ever produced one, regardless of what CLICK_DRAG_PX said. `"end"`
    // fires unconditionally for every gesture -- swallowed click or not.
    zoomBehavior.on("end", (e: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
      // "end" fires for every gesture that reaches gesture()'s active-count-to-zero moment, not
      // just a mouse click-or-drag: a wheel zoom debounces into its own gesture with an end (see
      // wheelidled in zoom.js), and the programmatic transforms above (the initial seed, jumpZoom)
      // run the whole start/zoom/end lifecycle in one synchronous call with no event at all. Gated
      // on the literal event TYPE, not `instanceof MouseEvent` -- WheelEvent extends MouseEvent in
      // the DOM, so that check would not exclude a wheel gesture's end.
      //
      // A touch tap reaches "end" too (touchended in zoom.js), carrying a real TouchEvent as
      // sourceEvent. `clientX`/`clientY` are not on a TouchEvent itself -- they live on
      // changedTouches[0]. d3 binds touchended to BOTH "touchend" and "touchcancel" in one `.on()`
      // string, so a cancel is deliberately NOT admitted; and changedTouches can in principle be
      // empty, so `point` falls through to `null` rather than reading index 0 of nothing.
      const src = e.sourceEvent as (MouseEvent | TouchEvent) | null;
      const point =
        src?.type === "mouseup" ? (src as MouseEvent)
        : src?.type === "touchend" ? ((src as TouchEvent).changedTouches[0] ?? null)
        : null;
      if (!point) return;
      if (traveledAsPan(gestureStart, e.transform)) return;
      // A genuine click (not a pan): open the inspector on whatever card is under it, or close an
      // already-open one when the click landed on empty board space. `pickAt` is the exact same
      // hit test `onMove` already uses for the hover tooltip -- one geometry, two consumers.
      const w = toWorld(point);
      const hit = pickAt(w.x, w.y);
      setInspectingId(hit?.id ?? null);
    });

    const onMove = (e: PointerEvent) => {
      const w = toWorld(e);
      const n = pickAt(w.x, w.y);
      const r = canvas.getBoundingClientRect();
      // A card's roles, translated to plain language -- the detailed build-category vocabulary the
      // canvas itself no longer shows.
      const detail = n ? (n.roles ?? []).map(subcategoryLabel).join(" · ") : "";
      if (hoveredIdRef.current !== (n?.id ?? null)) invalidate();
      hoveredIdRef.current = n?.id ?? null;
      // Fetch the full card for the one being APPROACHED, so crossing CARD_MODE_Z draws an image
      // that has already landed instead of starting the request that card mode then waits on.
      // Only the hovered card, and only once zoomed in past `PREFETCH_Z` — see card-node.ts for why
      // the whole-deck alternative (one `normal` per card, cropped for the disc) was rejected on
      // measurement. `request` dedupes, so pointermove firing continuously costs one fetch.
      // Urgent, or the prefetch is pointless: the board queued every disc on its first frame, so an
      // ordinary request for this card's full image lands behind all of them and arrives long after
      // the user has finished zooming.
      if (n?.artCrop && shouldPrefetchCard(camRef.current.z)) {
        artLoaderRef.current!.request(cardImageUrl(n.artCrop), true);
      }
      setHover(n
        ? {
            label: n.label, copies: n.copies ?? 1, deg: n.deg, detail,
            x: e.clientX - r.left, y: e.clientY - r.top,
          }
        : null);
    };

    canvas.addEventListener("pointermove", onMove);
    return () => {
      // Snapshot final positions so the next effect run can reuse them instead of re-throwing
      // everything.
      for (const n of nodes) prevPositions.set(n.id, n);
      simulation.stop();
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      selection.on(".zoom", null);
      delete (canvas as unknown as { __graphProbe?: () => unknown }).__graphProbe;
    };
    // `matches` and the paint mode are deliberately absent here. The paint mode moves no node --
    // it is read by draw() through huesRef, so switching it repaints the NEXT frame without
    // tearing down the simulation. That is the whole reason facets became paint: a mode change
    // must not cost a re-layout.
    //
    // `params` joins the deps for the dev tuning panel: moving a slider re-runs this effect, which
    // resumes every node from prevPositionsRef and reheats to alpha 0.3 -- the board re-settles at
    // the new constant rather than jumping. Outside dev it is DEFAULT_PARAMS and never changes
    // identity, so this costs a production render nothing.
  }, [graph, params]);

  // The inspected card and its edges, looked up fresh from `graph` on every render rather than
  // captured at click time -- `inspectingId` is the only state, so the panel always reflects the
  // current props even if `graph` were to change while it's open.
  const inspectingNode = inspectingId ? graph.nodes.find((n) => n.id === inspectingId) ?? null : null;
  const inspectingEdges = inspectingId
    ? graph.edges.filter((e) => e.from === inspectingId || e.to === inspectingId)
    : [];

  // Computed once per selection, never per frame: a BFS over ~260 edges is microseconds, but
  // recomputing it 60 times a second to get an identical answer is a frame-rate bug waiting to happen.
  //
  // Keyed on `inspectingNode`, not `inspectingId`: if `graph` changes while a selection is live and
  // the id no longer resolves to a node, `inspectingNode` goes null and so must `flow` -- keying on
  // the id alone left `flow` non-null with empty fans (the id still "selected", just resolving to
  // nothing), which dims every node with no inspector and no legend open to explain why.
  const flow = useMemo(
    () => (inspectingNode ? computeFlow(flowEdges, inspectingNode.id) : null),
    [graph, inspectingNode],
  );
  /** THE EVENTS INSIDE THIS FLOW, ranked by how many of its edges each explains, with a hue each.
   *
   *  This is what makes a flow readable: the board used to paint every edge in one of two colours
   *  that meant only up/down, so a token's forty-edge fan was one undifferentiated mesh. Hue carries
   *  the MECHANISM now and direction moves to the dash crawl. Scoped to the selected card's own
   *  flow, which is why a palette is possible at all -- see `FLOW_EVENT_HUES`. */
  const flowEvents = useMemo(() => {
    if (!flow) return [] as { verb: string; count: number; hue: string }[];
    const n = new Map<string, number>();
    for (const fe of flow.edges) {
      for (const verb of new Set((tagsByPairBody.get(`${fe.from}>${fe.to}`) ?? []).map((t) => t.split(":")[0]))) {
        n.set(verb, (n.get(verb) ?? 0) + 1);
      }
    }
    return [...n]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([verb, count], i) => ({ verb, count, hue: FLOW_EVENT_HUES[i] ?? OVERFLOW_HUE }));
  }, [flow, tagsByPairBody]);

  /** Which of the flow's own events the reader has isolated, or null for all of them. Cleared
   *  whenever the selection changes: an isolate is about THIS flow and would be a stale filter on
   *  the next one. */
  const [flowFocus, setFlowFocus] = useState<string | null>(null);
  useEffect(() => { setFlowFocus(null); }, [inspectingId]);

  const flowHueByVerb = useMemo(
    () => new Map(flowEvents.map((e) => [e.verb, e.hue])),
    [flowEvents],
  );
  const flowHueRef = useRef(flowHueByVerb);
  flowHueRef.current = flowHueByVerb;
  const flowFocusRef = useRef(flowFocus);
  flowFocusRef.current = flowFocus;

  const flowRef = useRef<Flow | null>(null);
  flowRef.current = flow;

  // What the flow hues mean, named with the selected card so direction reads in WORDS, not just
  // colour -- a blind judge shown teal/gold lines with no key could not tell producer from consumer
  // (task-5 brief).
  //
  // IT STACKS ON TOP OF THE PAINT LEGEND NOW, RATHER THAN REPLACING IT (roadmap H3). The old note
  // here said "what do the colours mean" has one answer on screen at a time -- but the two legends
  // answer DIFFERENT questions: the flow rows say what the EDGE hues mean, the paint rows say what
  // the card RIMS mean, and both are painted at once. Replacing meant switching TYPE -> ROLE while a
  // card was selected repainted every rim with no key anywhere on screen.
  //
  // HUE NOW NAMES THE MECHANISM, NOT THE DIRECTION (owner, 2026-08-27: "cool that I can see all the
  // events flowing, but even as an experienced Magic player this tells me nothing, I cannot
  // distinguish them"). Two hues meaning up/down told a reader nothing about WHAT was flowing, so
  // the rows list the flow's own events with their counts, and direction moved to the dash crawl --
  // which `FLOW_DASH`'s comment already called the encoding.
  const flowLegend = inspectingNode
    ? flowEvents.map((e) => ({
        value: e.verb,
        label: eventLabel(e.verb),
        hue: e.hue,
        count: e.count,
      }))
    : null;

  /** Reshapes __graphProbe()'s node array (with its `edges` property riding along) into what
   *  BoardTuner reads. Returns null before the first layout effect has run, or under a test with
   *  no canvas context. */
  const probeSnapshot = useCallback((): ProbeSnapshot | null => {
    const probe = (canvasRef.current as unknown as { __graphProbe?: () => unknown })?.__graphProbe;
    if (!probe) return null;
    const nodes = probe() as { id: string; x: number; y: number }[]
      & { edges?: readonly { from: string; to: string; target: number }[] };
    return { cards: nodes, edges: nodes.edges ?? [] };
  }, []);

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
          {/* Which facet paints the board. Chips, not a <select>: this is the primary control on
           *  this view and the one thing a reader changes on purpose. */}
          {PAINT_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={m.id === paintId}
              onClick={() => setPaintId(m.id)}
              className={`eyebrow rounded-(--radius) border px-2.5 py-1 ${
                m.id === paintId ? "border-(--accent) text-(--accent)" : "border-(--separator) text-(--muted)"
              }`}
            >
              {m.label}
            </button>
          ))}

          {/* Jumps the camera through zoomBehavior (jumpZoomRef, set by the layout effect) rather
           *  than through React state -- the paint loop reads cam.z every frame, so there is
           *  nothing for a re-render to do here, and going through zoomBehavior keeps its own
           *  bookkeeping in sync with cam. */}
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

          {/* TRACE ONE EVENT THROUGH THE DECK. Owner-reported: a click showed the flow but every
            *  mechanism in it looked alike, so a `dies` chain and an `enters` chain were one mesh.
            *
            *  A SEPARATE ROW FROM THE PAINT CHIPS, because they answer different questions and
            *  sitting them together implied they were alternatives: paint colours the CARDS by a
            *  facet, this filters the EDGES by a mechanism, and the two compose — trace `dies` while
            *  painting by role and the board says which roles the death chain runs through.
            *
            *  Capped at the eight commonest, with the count on each: the tail is verbs one or two
            *  edges carry, and a chip row long enough to wrap three times is a list, not a control.
            *  Absent entirely on a deck whose edges carry one event, where naming it changes
            *  nothing. */}
          {eventCounts.length > 1 ? (
            <div className="basis-full flex flex-wrap gap-2 items-baseline">
              <span className="eyebrow text-(--muted)">Trace event</span>
              <button
                type="button"
                aria-pressed={eventVerb === null}
                onClick={() => setEventVerb(null)}
                className={`eyebrow rounded-(--radius) border px-2.5 py-1 ${
                  eventVerb === null ? "border-(--accent) text-(--accent)" : "border-(--separator) text-(--muted)"
                }`}
              >
                All
              </button>
              {eventCounts.slice(0, 8).map(([verb, count]) => (
                <button
                  key={verb}
                  type="button"
                  aria-pressed={verb === eventVerb}
                  // Clicking the active chip clears it: the reader who wants out of a trace should
                  // not have to find "All".
                  onClick={() => setEventVerb((v) => (v === verb ? null : verb))}
                  className={`eyebrow rounded-(--radius) border px-2.5 py-1 ${
                    verb === eventVerb ? "border-(--accent) text-(--accent)" : "border-(--separator) text-(--muted)"
                  }`}
                >
                  {eventLabel(verb)} <span className="opacity-60">{count}</span>
                </button>
              ))}
            </div>
          ) : null}

          {/* Only when the deck HAS one: a chip that can never change anything is worse than no
            *  chip, and most decks make no unpartnered token at all. */}
          {landNodes.size > 0 ? (
            <button
              type="button"
              aria-pressed={showLands}
              onClick={() => setShowLands((v) => !v)}
              className={`eyebrow rounded-(--radius) border px-2.5 py-1 ${
                showLands ? "border-(--accent) text-(--accent)" : "border-(--separator) text-(--muted)"
              }`}
            >
              lands ({landNodes.size})
            </button>
          ) : null}

          {loneTokens.size > 0 ? (
            <button
              type="button"
              aria-pressed={showLoneTokens}
              onClick={() => setShowLoneTokens((v) => !v)}
              className={`eyebrow rounded-(--radius) border px-2.5 py-1 ${
                showLoneTokens ? "border-(--accent) text-(--accent)" : "border-(--separator) text-(--muted)"
              }`}
            >
              lone tokens ({loneTokens.size})
            </button>
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
          {/* A MATCH THE BOARD IS HIDING IS STILL A MATCH. Reporting only what is drawn made the
           *  count a false sentence about the deck; naming the count AND the filter holding it back
           *  makes it a true one the reader can act on in a click. */}
          {hiddenMatches ? (
            <button
              type="button"
              data-testid="graph-search-hidden"
              className="eyebrow text-(--accent)"
              onClick={() => {
                if (hiddenMatches.lands > 0) setShowLands(true);
                if (hiddenMatches.tokens > 0) setShowLoneTokens(true);
              }}
            >
              +{hiddenMatches.total} hidden — show
            </button>
          ) : null}
        </div>

        {/* What the colours mean. In the DOM rather than on the canvas: a canvas label's measured
         *  box does not scale with zoom the way the board does, so which labels collided -- and
         *  therefore where they got pushed -- was zoom-dependent.
         *
         *  A ROW ABOVE THE BOARD, NOT AN OVERLAY ON IT: it used to float over the top-left
         *  corner and cover whatever the force put there — on the review deck, four discs and
         *  their labels. Above the canvas it costs one line of height and hides nothing.
         *  `pointer-events-none` stays anyway, because the canvas binds pointermove/wheel
         *  directly on itself, so a sibling capturing pointer events puts a dead zone on it. No scroll cap: a paint mode's values are
         *  bounded (8 types, 6 colours, 7 roles, 8 mana-value buckets), unlike the 40-80 rooms
         *  the subtype preset could produce. */}
        <div
          data-testid="paint-legend"
          role="group"
          aria-label="Paint legend"
          className="pointer-events-none flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-(--muted)"
        >
          {/* A FLOW ROW IS A BUTTON AND A PAINT ROW IS NOT, because only the first has something to
            *  isolate: clicking an event dims the rest of the flow, which is the "and filter them"
            *  half of the same complaint. Clicking it again clears. The paint rows stay inert, so
            *  the group keeps `pointer-events-none` off only where a target exists. */}
          {(flowLegend ?? []).map((row) => (
            <button
              key={`flow:${row.value}`}
              type="button"
              data-testid="paint-legend-row"
              data-value={row.value}
              aria-pressed={flowFocus === row.value}
              onClick={() => setFlowFocus((v) => (v === row.value ? null : row.value))}
              // THE CONTAINER STAYS `pointer-events-none` AND THE BUTTON OPTS BACK IN. The legend
              // can overlay the canvas, and a group that swallows drags puts a dead zone on the
              // board -- a standing constraint with its own test. Only the rows that have something
              // to isolate become targets.
              className={`pointer-events-auto flex items-center gap-1.5 ${
                flowFocus === row.value ? "text-(--foreground)" : ""}`}
            >
              {/* A DASHED ARROW, NOT A DISC, AND THAT IS THE WHOLE SEPARATION FROM THE PAINT
                *  LEGEND BESIDE IT. Both legends sit on one strip and both used a filled circle,
                *  so a reader could not tell which dots named a LINE and which named a NODE. A
                *  swatch that looks like the mark it labels needs no label to say so -- and this
                *  one is the painted edge exactly: same dash, same arrowhead, same hue. */}
              <svg aria-hidden="true" width="18" height="8" viewBox="0 0 18 8" className="shrink-0">
                <path d="M0 4h11" stroke={row.hue} strokeWidth="2" strokeDasharray="3 2.5" />
                <path d="M11 1.2 15.5 4 11 6.8z" fill={row.hue} />
              </svg>
              <span>{row.label}</span>
              <span className="stat-num opacity-70">{row.count}</span>
            </button>
          ))}
          {legend.map((row) => (
            <div
              key={row.value}
              data-testid="paint-legend-row"
              data-value={row.value}
              className="pointer-events-none flex items-center gap-1.5"
            >
              {/* A graphic object next to text, so it carries the 3:1 floor the palette was
               *  validated against. The text beside it is the page's normal foreground. */}
              <span
                aria-hidden="true"
                style={{ background: row.hue }}
                className="inline-block size-2.5 shrink-0 rounded-full"
              />
              <span className="whitespace-nowrap">{row.label}</span>
              {row.count !== undefined ? <span className="stat-num text-(--muted)">{row.count}</span> : null}
            </div>
          ))}
        </div>

        <div
          className={`relative rounded-(--radius) border border-(--border) overflow-hidden ${
            isFullscreen ? "flex-1 min-h-0" : "h-[380px] sm:h-[520px]"
          }`}
        >
          <canvas
            ref={canvasRef}
            className="block w-full h-full cursor-grab touch-none"
            aria-label={`Deck graph: ${graph.nodes.length} cards, ${graph.edges.length} synergies`}
          />
          {hover ? (
            <div
              className="pointer-events-none absolute rounded-(--radius) border border-(--border) bg-(--background) px-2 py-1 text-xs whitespace-nowrap"
              style={{ left: hover.x + 12, top: hover.y + 12 }}
            >
              {hover.label}{" "}
              <span className="text-(--muted) stat-num">
                {hover.copies > 1 ? `×${hover.copies} · ` : ""}{hover.deg} partners
              </span>
              {hover.detail ? <span className="text-(--muted)"> · {hover.detail}</span> : null}
            </div>
          ) : null}

          {/* import.meta.env.DEV is a compile-time constant, so Vite drops this branch and the
           *  BoardTuner import entirely from a production build. `debug` is the toggle that
           *  already reveals the Card/Miniature buttons -- the panel joins them rather than
           *  inventing a second way in. Rendered INSIDE this `relative` wrapper so BoardTuner's own
           *  `absolute top-2 right-2` resolves against the canvas, not the page. */}
          {import.meta.env.DEV && debug ? (
            <BoardTuner params={params} onChange={setParams} probe={probeSnapshot} />
          ) : null}

          {/* Drill-down: what made this pair. See CardInspector.tsx's own doc comment for the
           *  provenance limit (tag + text, no clause id). Opened by the click path wired into
           *  zoomBehavior's "end" handler above; the hover tooltip stays alongside it rather than
           *  being replaced -- hover answers "what is this", click answers "why is this here". */}
          {inspectingNode ? (
            <CardInspector
              node={inspectingNode}
              edges={inspectingEdges}
              flow={flow}
              onClose={() => setInspectingId(null)}
            />
          ) : null}
        </div>
        {/* INSIDE shellRef, deliberately. Fullscreen paints only the fullscreen element's subtree,
         *  so a caption left as a sibling vanishes in exactly the mode where the board is largest --
         *  and it is the one sentence that says what the geometry MEANS. Three blind judges asked
         *  "what is this organised by?"; the two who could not see this line answered "card type". */}
        <p className="text-(--muted) text-sm">
          Drag to pan, scroll to zoom. Two cards sit close because they do something for each other —
          position is synergy, and colour is what the cards are.
        </p>
      </div>
    </div>
  );
}
