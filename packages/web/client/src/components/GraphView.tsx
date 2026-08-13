import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type D3ZoomEvent } from "d3-zoom";
import type { CardGraph, DeckReport } from "../types.js";
import { createArtLoader, type ArtLoader } from "./art-loader.js";
import { cachedImageLoad } from "./art-cache.js";
import { CARD_MODE_Z, MAX_Z, cardImageUrl, renderModeFor } from "./card-node.js";
import {
  PAINT_MODES, paintHues, paintLegend, rimArcs, subcategoryLabel,
} from "./presets.js";
import {
  ART_RADIUS, createBoardSimulation, DEFAULT_PARAMS, linkDistanceFor, nodeRadius,
  type BoardParams, type Sim, type SimLink,
} from "./board-force.js";
import { BoardTuner, type ProbeSnapshot } from "./BoardTuner.js";
import { CardInspector } from "./CardInspector.js";
import { labelPriority, placeLabels } from "./labels.js";
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

/** Screen px a card-name label renders at, held constant across zoom -- world-unit font size is
 *  `LABEL_PX / cam.z`, same trick as the ×copies badge a few lines below. The formula was never the
 *  defect (see labels.ts); what got labels deleted was letting the measured box feed back into
 *  layout. It never does here: this constant reaches only the label pass at the end of draw(). */
const LABEL_PX = 11;
/** Below this zoom, most of the board is too small on screen for a name to mean anything -- only a
 *  commander or whatever's under the pointer still gets one. */
const LABEL_ZOOM_FLOOR = 0.6;

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

export function GraphView({ graph, report }: { graph: CardGraph; report: DeckReport }) {
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
  const artLoaderRef = useRef<ArtLoader>(undefined);
  artLoaderRef.current ??= createArtLoader({ load: cachedImageLoad() });
  // Effect-local until the filter chips existed, which is why toggling one reset the view. A ref
  // survives the effect re-running, and the mode buttons below need to write z from outside it.
  const camRef = useRef({ x: 0, y: 0, z: 1 });
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

  // The layout effect's draw() reads this through a ref rather than closing over `matches`
  // directly, and `matches` is deliberately absent from that effect's dependency array below --
  // the effect owns the force simulation, and adding `matches` there would reheat and re-seed the
  // whole layout on every keystroke, moving the board under the user while they type.
  const matchesRef = useRef<Set<string> | null>(null);
  matchesRef.current = matches;

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
        x: Math.cos(i) * 260 + Math.random() * 30,
        y: Math.sin(i) * 260 + Math.random() * 30,
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
    // positions only needs enough to let what changed find its place.
    simulation.alpha(isFirstLayout ? 1 : 0.3);

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
      ctx.strokeStyle = paintColors.sep;
      for (const l of links) {
        ctx.lineWidth = edgeWidth(l.weight, maxWeight) / cam.z;
        ctx.beginPath();
        ctx.moveTo(l.source.x, l.source.y); ctx.lineTo(l.target.x, l.target.y);
        ctx.stroke();
      }

      // A search dims what does not match rather than hiding it, so the deck keeps its shape and
      // you can see WHERE the match sits. `matchIds` null means no active search: dim nothing.
      // Read through the ref (see matchesRef above), never `matches` directly -- this closure is
      // rebuilt only when the effect re-runs, and the effect must not re-run on every keystroke.
      const matchIds = matchesRef.current;
      const mode = renderModeFor(cam.z);
      const cardW = ART_RADIUS * 2, cardH = cardW * 1.4;
      for (const n of nodes) {
        ctx.globalAlpha = matchIds && !matchIds.has(n.id) ? 0.15 : 1;

        // Render is a function of the camera, not a stored mode (card-node.ts's doc comment) --
        // reading cam.z here means the scroll wheel and the mode buttons can never disagree
        // about what's on screen. Card mode's source is a DIFFERENT cache key (cardImageUrl
        // rewrites the path segment to a bigger size), so switching modes cold is a real fetch,
        // not just a bigger draw of what miniature mode already had loaded.
        const src = mode === "card" && n.artCrop ? cardImageUrl(n.artCrop) : n.artCrop;
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
              ctx.arc(n.x + offset, n.y - offset, ART_RADIUS, 0, TAU);
              ctx.stroke();
            }
          }
        }

        const hues = huesRef.current.get(n.id) ?? [];

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
          ctx.beginPath(); ctx.arc(n.x, n.y, ART_RADIUS, 0, TAU); ctx.clip();
          ctx.drawImage(img, (sw - s) / 2, (sh - s) / 2, s, s,
            n.x - ART_RADIUS, n.y - ART_RADIUS, ART_RADIUS * 2, ART_RADIUS * 2);
          ctx.restore();
        } else {
          // Covers both "no art at all" and "card mode wants an image that hasn't loaded yet" -- a
          // blank node is worse than a small one, so this always requests `src` (whichever size the
          // current mode wants) and draws a placeholder rather than nothing. The FILL is the point:
          // it is the only thing on screen at the moment the user is zoomed in and looking at
          // nothing else, so it has to read as a solid loading signal. Filled in the card's own
          // paint hue, so a deck whose art has not landed is still readable by facet.
          if (src) artLoader.request(src);
          ctx.fillStyle = hues[0] ?? paintColors.muted;
          if (mode === "card") {
            ctx.fillRect(n.x - cardW / 2, n.y - cardH / 2, cardW, cardH);
          } else {
            ctx.beginPath(); ctx.arc(n.x, n.y, nodeRadius(), 0, TAU); ctx.fill();
          }
        }

        // What this card IS, under the current paint mode. Drawn for both the art and the fallback
        // branch: a card whose art failed to load must not lose its facet signal along with its
        // picture. Hue rides the rim, never a fill over the art -- a translucent wash over this
        // surface collapses toward gray (measured) and stops separating.
        if (mode === "card") {
          // Equal-width bars along the card's bottom edge. Card mode paints a rectangle, so there
          // is no rim to stroke arcs onto.
          const barW = cardW / Math.max(hues.length, 1);
          hues.forEach((hue, i) => {
            ctx.fillStyle = hue;
            ctx.fillRect(n.x - cardW / 2 + i * barW, n.y + cardH / 2 - BAR_H, barW, BAR_H);
          });
          if (hues.length === 0) {
            ctx.lineWidth = 1 / cam.z;
            ctx.strokeStyle = paintColors.border;
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
            ctx.strokeStyle = paintColors.border;
            ctx.beginPath(); ctx.arc(n.x, n.y, ART_RADIUS, 0, TAU); ctx.stroke();
          }
        }

        if (matchIds?.has(n.id)) {
          ctx.lineWidth = 2.5 / cam.z;
          ctx.strokeStyle = paintColors.accent;
          if (mode === "card") {
            ctx.strokeRect(n.x - cardW / 2 - 3, n.y - cardH / 2 - 3, cardW + 6, cardH + 6);
          } else {
            ctx.beginPath(); ctx.arc(n.x, n.y, ART_RADIUS + 3, 0, TAU); ctx.stroke();
          }
        }

        if (copies > 1) {
          ctx.font = `500 ${10 / cam.z}px "JetBrains Mono", ui-monospace, monospace`;
          ctx.textAlign = "center";
          ctx.fillStyle = paintColors.fg;
          ctx.fillText(`×${copies}`, n.x, n.y + ART_RADIUS + 11 / cam.z);
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
      const hoveredId = hoveredIdRef.current;
      const hoveredSet = hoveredId
        ? new Set([hoveredId, ...(neighborsOf.get(hoveredId) ?? [])])
        : new Set<string>();
      const candidates = cam.z < LABEL_ZOOM_FLOOR
        ? nodes.filter((n) => commandersRef.current.has(n.id) || hoveredSet.has(n.id))
        : nodes;
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
        const boxes = order.map((id) => {
          const n = byId.get(id)!;
          const wScreen = ctx.measureText(n.label).width * cam.z;
          const sx = n.x * cam.z + cam.x, sy = n.y * cam.z + cam.y;
          return { id, x: sx - wScreen / 2, y: sy - nodeRadius() * cam.z - LABEL_PX, w: wScreen, h: LABEL_PX };
        });
        // Same dimming rule the node pass uses a few lines up, and the same reason: a search keeps
        // the deck's shape rather than hiding what doesn't match, so a matching card's NAME must
        // read as clearly as its ring does. `matchIds` (not `matches`) -- see the node pass's own
        // comment on why this reads the ref.
        for (const id of placeLabels(boxes)) {
          const n = byId.get(id)!;
          ctx.globalAlpha = matchIds && !matchIds.has(id) ? 0.15 : 1;
          ctx.fillText(n.label, n.x, n.y - nodeRadius() - 4 / cam.z);
        }
        // Canvas state is global and persistent (draw()'s own reset a few lines up already makes
        // this mistake impossible for the node pass) -- a search left dimming on here would leak
        // into next frame's background wipe.
        ctx.globalAlpha = 1;
      }
    };

    const loop = () => {
      simulation.tick();
      draw();
      raf = requestAnimationFrame(loop);
    };
    loop();

    // A resize only needs the canvas's own backing-store size updated. cam.x/y (the zoom translate)
    // is deliberately left untouched: it is an absolute, top-left-anchored offset, not a
    // centre-relative one, so there is no dim-dependent term in it to recompute. A resize keeps the
    // current pan/zoom exactly where it was on screen rather than re-centring the board, which
    // would fight a user who has already panned.
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

    const pickAt = (wx: number, wy: number): Sim | null => {
      // Card mode paints a 5:7 RECTANGLE (ART_RADIUS*2 wide, *1.4 tall -- see draw()'s
      // `mode === "card"` branch), not the disc nodeRadius() reports for the sim/miniature paint.
      // Hit-testing the inscribed circle there left the top/bottom bands and all four corners dead
      // to the pointer. Computed once per pick rather than per node: it depends only on cam.z.
      const cardMode = renderModeFor(cam.z) === "card";
      let best: Sim | null = null, bd = Infinity;
      for (const n of nodes) {
        const dx = n.x - wx, dy = n.y - wy;
        const inside = cardMode
          ? Math.abs(dx) <= ART_RADIUS && Math.abs(dy) <= ART_RADIUS * 1.4
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
      hoveredIdRef.current = n?.id ?? null;
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
      removeEventListener("resize", onResize);
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
            aria-label={`Deck graph: ${graph.nodes.length} cards, ${graph.edges.length} synergies`}
          />
          {/* What the colours mean. In the DOM rather than on the canvas: a canvas label's measured
           *  box does not scale with zoom the way the board does, so which labels collided -- and
           *  therefore where they got pushed -- was zoom-dependent.
           *
           *  `pointer-events-none` because the canvas binds pointermove/wheel directly on itself
           *  (not delegated from the wrapper), so a sibling that captured pointer events would put
           *  a dead zone over the board wherever it sits. No scroll cap: a paint mode's values are
           *  bounded (8 types, 6 colours, 7 roles, 8 mana-value buckets), unlike the 40-80 rooms
           *  the subtype preset could produce. */}
          <div
            data-testid="paint-legend"
            role="group"
            aria-label="Paint legend"
            className="pointer-events-none absolute left-2 top-2 rounded-(--radius) border border-(--border) bg-(--background)/90 px-2 py-1 text-xs"
          >
            {legend.map((row) => (
              <div
                key={row.value}
                data-testid="paint-legend-row"
                data-value={row.value}
                className="flex items-center gap-1.5"
              >
                {/* A graphic object next to text, so it carries the 3:1 floor the palette was
                 *  validated against. The text beside it is the page's normal foreground. */}
                <span
                  aria-hidden="true"
                  style={{ background: row.hue }}
                  className="inline-block size-2.5 shrink-0 rounded-full"
                />
                <span className="whitespace-nowrap">{row.label}</span>
                <span className="font-mono tabular-nums text-(--muted)">{row.count}</span>
              </div>
            ))}
          </div>
          {hover ? (
            <div
              className="pointer-events-none absolute rounded-(--radius) border border-(--border) bg-(--background) px-2 py-1 text-xs whitespace-nowrap"
              style={{ left: hover.x + 12, top: hover.y + 12 }}
            >
              {hover.label}{" "}
              <span className="text-(--muted) font-mono tabular-nums">
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
              onClose={() => setInspectingId(null)}
            />
          ) : null}
        </div>
      </div>
      <p className="text-(--muted) text-sm">
        Drag to pan, scroll to zoom. Two cards sit close because they do something for each other —
        position is synergy, and colour is what the cards are.
      </p>
    </div>
  );
}
