import { useEffect, useMemo, useRef, useState } from "react";
import type { CardGraph, DeckReport, GraphNode, NodeKind } from "../types.js";
import { createArtLoader, type ArtLoader } from "./art-loader.js";
import { cachedImageLoad } from "./art-cache.js";
import { glyphFor } from "./graph-glyphs.js";
import { ROOM_HUE, ROOMS, roomCenter, roomLayout, roomsForCard, roomTallies, subcategoryLabel, type RoomId } from "./deck-rooms.js";

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
/** Radius (world units) an art-filled card node draws at -- see Step 3 of the task brief. */
const ART_RADIUS = 14;
/** Glyphs are authored in a 24x24 box (see graph-glyphs.ts); half that is the box's own centre. */
const GLYPH_BOX_HALF = 12;

/** The radius a node is DRAWN at, in world units. Every consumer -- the repulsion sweep, the edge
 *  springs, hit-testing, the label collision pass -- reads this one function, so the simulated size
 *  and the painted size cannot drift apart. They did: cards simulated at 3.5 while their art painted
 *  at ART_RADIUS (14), so nodes settled until they touched at ~7px apart and were then drawn four
 *  times that size. That mismatch is what made the graph unreadable. */
export function nodeRadius(n: { kind: string; deg: number }): number {
  return n.kind === "card" ? ART_RADIUS : Math.min(3 + Math.sqrt(n.deg) * 1.5, 15);
}

/** Layout tuning. Settled during Task 7 against a real deck (inalla.txt) in a browser, measured
 *  with the __graphProbe metrics rather than eyeballed -- across at least 10 independent
 *  fresh-load trials per candidate, not a single run, because initial positions carry
 *  Math.random() jitter (see seedPosition/the sim setup) and separationRatio has real run-to-run
 *  spread. Keep them together: a constant that lives next to its use is a constant nobody
 *  re-tunes as a set.
 *
 *  ZONE_SPRING vs LINK_STIFFNESS is the load-bearing ratio here: every card links to several
 *  concept nodes (keyword/event/subtype/...) that are shared across cards of every role, and those
 *  links pull toward the same hub regardless of role. At the original 0.004/0.008 (link twice as
 *  stiff as the zone pull), that hub-pull dominated and same-role cards ended up statistically
 *  *farther* apart than different-role cards (separationRatio 1.147, round 1). Each retune needed
 *  a real multi-trial noise check, not 1-2 samples, to be trusted -- see task-7-report.md's full
 *  measurement history: 0.024/0.004 (6x ratio) looked fine on 2 trials (~0.57-0.62) but a 5-trial
 *  check found mean 0.706 with one trial at 1.008 -- a false pass. 0.06/0.002 (30x) held for 5
 *  trials (0.438-0.497) but widened out over 10 (spread 0.132 vs. a margin of only 0.121 to the
 *  gate) -- still not a safe margin. 0.1/0.0012 (~83x) is what's settled: 10 trials landed
 *  0.430-0.477, a spread of 0.047 against a gate margin of 0.222 -- comfortably tighter than the
 *  headroom, not just narrower than one lucky pair of samples.
 *
 *  Task 8 re-tuned COLLISION_PAD/ZONE_SPRING/REPULSION against the room board (concept nodes
 *  hidden by default, so these springs are now the whole simulation for a card). ZONE_SPRING 0.1 /
 *  REPULSION 1400 (Task 7's ring-anchor values) held overlaps at 0 only if left to settle ~9s;
 *  under a shorter settle window overlaps ran 53-61/10 trials. 0.05 / 2200 (with COLLISION_PAD 5)
 *  converged to 0 overlaps in all 20 fresh-load trials measured (two independent 10-trial batches,
 *  see task-8-report.md) with the same ~9s settle. A third candidate, 0.25 / 1800, made overlaps
 *  *worse* (17-27/10) -- a stronger zone spring re-compresses cards faster than collision can
 *  resolve them, it does not help convergence.
 *
 *  The room-*membership* gate ("cards outside every room they belong to" = 0) could NOT be reached
 *  by any combination of these constants, and is not a tuning problem: see task-8-report.md's
 *  "Plan defect" section. In short, a card belonging to N rooms feels N equal-weight springs
 *  (`n.vx += (c.x - n.x) * ZONE_SPRING` once per room, unconditionally), whose equilibrium is the
 *  unweighted average of those rooms' centres -- a fact independent of ZONE_SPRING's magnitude
 *  (`k*(c1-x) + k*(c2-x) = 0` gives `x = (c1+c2)/2` for any nonzero `k`). Every card in this
 *  reference deck (inalla.txt) that has a build role also belongs to Strategy (deck-rooms.ts's
 *  `strategyCards` adds Strategy independent of the fallback, matching the design doc's "archetype
 *  groups, plus every card no other room claims"), and Strategy's row is not adjacent to Ramp's,
 *  Lands', or Board wipes' row on the fixed GRID -- so that average provably lands in the row
 *  between them, outside every rect involved, for any constant value. Reordering GRID or splitting
 *  the zone force by room weight would fix it but is a structural change outside this task's
 *  remit (constants only); flagged instead of worked around. */
const COLLISION_PAD = 5;
const EDGE_GAP = 28;
const ZONE_SPRING = 0.05;
const CENTER_PULL = 0.0004;
/** Repulsion numerator (world-units^3/tick) for the all-pairs inverse-square push. */
const REPULSION = 2200;
/** Link-spring stiffness pulling an edge toward its rest length. Softened from 0.008 alongside the
 *  ZONE_SPRING increase above -- see the comment on this block. */
const LINK_STIFFNESS = 0.0012;
/** Per-tick velocity damping (0..1, higher = less friction). */
const VELOCITY_DAMPING = 0.86;

interface Sim extends GraphNode { x: number; y: number; vx: number; vy: number; deg: number }
type Point = { x: number; y: number };

/** Positional correction for an overlapping pair of discs, or null when they are already clear.
 *  Returned value applies to the first node; the second gets its negation. Positional rather than
 *  velocity-only because a velocity nudge lets discs pass through each other for several frames,
 *  and "no two card discs visibly overlap" is this work's acceptance condition, not a target. */
export function separation(
  dx: number, dy: number, ra: number, rb: number, pad: number,
): { x: number; y: number } | null {
  const want = ra + rb + pad;
  const d = Math.hypot(dx, dy);
  if (d >= want) return null;
  // Coincident nodes have no centre line to push along; pick a fixed direction so the result is
  // deterministic (a random jitter here makes layouts irreproducible and the judge's metrics noisy).
  if (d === 0) return { x: want / 2, y: 0 };
  const push = (want - d) / 2;
  return { x: (dx / d) * push, y: (dy / d) * push };
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [query, setQuery] = useState("");
  // Capability check rather than a user-agent sniff: iOS Safari on iPhone has no element
  // fullscreen, and a button that silently does nothing is worse than no button.
  const canFullscreen = typeof Element !== "undefined" && "requestFullscreen" in Element.prototype;

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

  const counts = useMemo(() => {
    const c = new Map<NodeKind, number>();
    for (const n of graph.nodes) c.set(n.kind, (c.get(n.kind) ?? 0) + 1);
    return c;
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

  /** Which rooms each card node belongs to, keyed by node id. Recomputed only when the graph or
   *  the report changes -- it is pure over both. */
  const roomsByNode = useMemo(() => {
    const comboCards = new Set((report.combos ?? []).flatMap((c) => c.cards));
    const out = new Map<string, RoomId[]>();
    for (const n of graph.nodes) {
      if (n.kind !== "card") continue;
      out.set(n.id, roomsForCard(n.roles, n.label, comboCards));
    }
    return out;
  }, [graph, report]);

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
    return roomTallies(cardRooms, report.buildCategories, copiesByNameOf(graph.nodes));
  }, [graph, report, roomsByNode]);

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
    // Rooms are fixed: every deck gets all seven, in the same places, whether or not cards land
    // in them. Replaces the old ring of present-roles-only anchors -- an empty room is a finding
    // ("BOARD WIPES 0/3"), so it has to hold its place on the board rather than vanish.
    let rooms = roomLayout(dim.w, dim.h);

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
    const links = graph.edges
      .map((e) => ({ s: byId.get(e.from), t: byId.get(e.to) }))
      .filter((l): l is { s: Sim; t: Sim } => Boolean(l.s && l.t));
    for (const l of links) { l.s.deg++; l.t.deg++; }

    const visible = (n: Sim) => !hidden.has(n.kind);

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
        { tallies },
      );

    // A from-scratch graph gets full energy to organize; a graph that already has settled
    // positions (a filter toggle, or -- once deckbuilding lands -- a card added/removed) only
    // needs enough to let what changed find its place. See Step 0 / the deck-view-mode stub.
    let alpha = isFirstLayout ? 1 : 0.3;
    const cam = { x: 0, y: 0, z: 1 };
    let raf = 0;
    let dragging: { x: number; y: number } | null = null;

    // ponytail: O(n^2) repulsion per tick, fine at the few-hundred nodes a deck produces
    // (~350 = 60k pairs). Barnes-Hut if a corpus-scale selection ever renders here.
    const tick = () => {
      const live = nodes.filter(visible);
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i], b = live[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          // Floored at 64 (d=8), not just the exact-zero case: at d2=0.25 REPULSION/d2 is 5600,
          // which flings a node straight past the d2>220000 cutoff below where nothing pushes back.
          // Safe to floor this high -- separation() (see below) already keeps any settled pair at
          // least ra+rb+pad apart, and the smallest two node kinds that can be adjacent (two deg-0
          // non-card nodes, radius 3 each) settle no closer than 3+3+COLLISION_PAD(4) = 10, which is
          // already outside this floor. It only engages on freshly-seeded/coincident nodes before
          // separation has had a tick to act, not on anything Task 7 measured.
          const d2 = Math.max(dx * dx + dy * dy, 64);
          if (d2 > 220000) continue;
          const d = Math.sqrt(d2), f = REPULSION / d2;
          a.vx += (dx / d) * f; a.vy += (dy / d) * f;
          b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;

          // Hard separation: discs must not overlap. Applied to position, not velocity.
          const s = separation(dx, dy, nodeRadius(a), nodeRadius(b), COLLISION_PAD);
          if (s) { a.x += s.x; a.y += s.y; b.x -= s.x; b.y -= s.y; }
        }
      }
      for (const l of links) {
        if (!visible(l.s) || !visible(l.t)) continue;
        const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
        const d = Math.hypot(dx, dy) || 1;
        // Rest length scales with what it joins: a spring between two 14px discs and one between two
        // 3px dots should not want the same length.
        const rest = nodeRadius(l.s) + nodeRadius(l.t) + EDGE_GAP;
        const f = (d - rest) * LINK_STIFFNESS;
        l.s.vx += (dx / d) * f; l.s.vy += (dy / d) * f;
        l.t.vx -= (dx / d) * f; l.t.vy -= (dy / d) * f;
      }
      // Zones bias the layout, they don't replace it: a weak spring per room toward that room's
      // rectangle centre, added on top of the repulsion/edge springs above. A card in two rooms
      // (a combo piece that's also a build role, say) feels both and settles between them; every
      // card is in at least one room (strategy is the fallback), so this always applies to cards.
      for (const n of live) {
        if (n.kind !== "card") continue;
        for (const id of roomsByNode.get(n.id) ?? []) {
          const rect = rooms.get(id);
          if (!rect) continue;
          const c = roomCenter(rect);
          n.vx += (c.x - n.x) * ZONE_SPRING;
          n.vy += (c.y - n.y) * ZONE_SPRING;
        }
      }
      for (const n of live) {
        // Centering applies only where no zone claims the node. It used to apply to everything at
        // 0.0011 while the zone spring was 0.0009 -- the pull to the origin was stronger than the
        // pull to the zone, so roles could never separate however hard the zones pulled. Now that
        // every card lands in a room (strategy is the universal fallback), this only still fires
        // for non-card nodes (events/keywords/etc.), which have no room of their own.
        const zoned = n.kind === "card" && (roomsByNode.get(n.id)?.length ?? 0) > 0;
        if (!zoned) { n.vx -= n.x * CENTER_PULL; n.vy -= n.y * CENTER_PULL; }
        n.vx *= VELOCITY_DAMPING; n.vy *= VELOCITY_DAMPING;
        n.x += n.vx * alpha; n.y += n.vy * alpha;
      }
      alpha = Math.max(alpha * 0.995, 0.02);
    };

    const artLoader = artLoaderRef.current!;

    const pathFor = (glyph: string): Path2D => {
      const cache = pathCacheRef.current!;
      let p = cache.get(glyph);
      if (!p) { p = new Path2D(glyph); cache.set(glyph, p); }
      return p;
    };

    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = paint.surface;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(cam.z * dim.dpr, 0, 0, cam.z * dim.dpr,
        (dim.w / 2 + cam.x) * dim.dpr, (dim.h / 2 + cam.y) * dim.dpr);

      // The board: seven fixed rooms, drawn behind everything and drawn even when empty --
      // "BOARD WIPES 0/3" is the finding, so the room has to hold its place to show the hole.
      // Hue rides the outline and the label, never the fill: a translucent fill over this surface
      // collapses toward gray (measured -- see the plan's constraints), so it cannot be what tells
      // two rooms apart. Position and the always-visible label do that; the wash only gives the
      // region a body, and doubles where a straddling card sits between two rooms.
      ctx.textAlign = "center";
      for (const room of ROOMS) {
        const rect = rooms.get(room.id);
        if (!rect) continue;
        const tally = tallies.get(room.id);
        const hue = ROOM_HUE[room.id];

        ctx.globalAlpha = 0.10;
        ctx.fillStyle = hue;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.globalAlpha = 1;

        ctx.lineWidth = 1.5 / cam.z;
        ctx.strokeStyle = hue;
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

        ctx.font = `500 ${12 / cam.z}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.fillStyle = tally?.under ? paint.warning : hue;
        const count = tally ? (tally.target > 0 ? `${tally.count}/${tally.target}` : `${tally.count}`) : "";
        ctx.fillText(`${room.label.toUpperCase()} ${count}`.trim(), rect.x + rect.w / 2, rect.y + 16 / cam.z);
      }

      ctx.lineWidth = 0.7 / cam.z;
      ctx.strokeStyle = paint.sep;
      ctx.beginPath();
      for (const l of links) {
        if (!visible(l.s) || !visible(l.t)) continue;
        ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y);
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
          const img = n.artCrop ? artLoader.get(n.artCrop) : undefined;
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
              ctx.beginPath();
              ctx.arc(n.x + offset, n.y - offset, ART_RADIUS, 0, TAU);
              ctx.stroke();
            }
          }

          if (img instanceof HTMLImageElement && img.naturalWidth > 0 && img.naturalHeight > 0) {
            const sw = img.naturalWidth, sh = img.naturalHeight, s = Math.min(sw, sh);
            ctx.save();
            ctx.beginPath(); ctx.arc(n.x, n.y, ART_RADIUS, 0, TAU); ctx.clip();
            ctx.drawImage(img, (sw - s) / 2, (sh - s) / 2, s, s,
              n.x - ART_RADIUS, n.y - ART_RADIUS, ART_RADIUS * 2, ART_RADIUS * 2);
            ctx.restore();
            ctx.lineWidth = 1 / cam.z;
            ctx.strokeStyle = paint.border;
            ctx.beginPath(); ctx.arc(n.x, n.y, ART_RADIUS, 0, TAU); ctx.stroke();
          } else {
            if (n.artCrop) artLoader.request(n.artCrop);
            ctx.fillStyle = colorOf(n.kind);
            ctx.beginPath(); ctx.arc(n.x, n.y, nodeRadius(n), 0, TAU); ctx.fill();
          }

          if (matchIds?.has(n.id)) {
            ctx.lineWidth = 2.5 / cam.z;
            ctx.strokeStyle = paint.accent;
            ctx.beginPath(); ctx.arc(n.x, n.y, ART_RADIUS + 3, 0, TAU); ctx.stroke();
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

    const loop = () => { tick(); draw(); raf = requestAnimationFrame(loop); };
    loop();

    // Room geometry is sized off the viewport, so a resize/rotate has to recompute it too --
    // otherwise the rooms stay sized to whatever viewport was live at mount and a rotated phone
    // gets a board built for the wrong aspect ratio.
    const onResize = () => {
      dim = size();
      rooms = roomLayout(dim.w, dim.h);
    };
    addEventListener("resize", onResize);

    const pick = (ev: PointerEvent): Sim | null => {
      const r = canvas.getBoundingClientRect();
      const wx = (ev.clientX - r.left - dim.w / 2 - cam.x) / cam.z;
      const wy = (ev.clientY - r.top - dim.h / 2 - cam.y) / cam.z;
      let best: Sim | null = null, bd = Infinity;
      for (const n of nodes) {
        if (!visible(n)) continue;
        // Normalised: distance as a fraction of the node's own drawn radius, so every node is
        // clickable exactly where it is painted rather than inside a fixed box.
        const d = Math.hypot(n.x - wx, n.y - wy) / nodeRadius(n);
        if (d <= 1 && d < bd) { bd = d; best = n; }
      }
      return best;
    };

    const onDown = (e: PointerEvent) => { dragging = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); };
    const onUp = () => { dragging = null; };
    const onMove = (e: PointerEvent) => {
      if (dragging) {
        cam.x += e.clientX - dragging.x; cam.y += e.clientY - dragging.y;
        dragging = { x: e.clientX, y: e.clientY };
        return;
      }
      const n = pick(e);
      const r = canvas.getBoundingClientRect();
      // The canvas shows only room labels now (Task 5+), so the detailed build-category
      // vocabulary lives here instead -- a card's roles, translated to plain language.
      const detail = n && n.kind === "card" ? (n.roles ?? []).map(subcategoryLabel).join(" · ") : "";
      setHover(n
        ? { label: n.label, kind: n.kind, deg: n.deg, detail, x: e.clientX - r.left, y: e.clientY - r.top }
        : null);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.z = Math.min(5, Math.max(0.15, cam.z * (e.deltaY < 0 ? 1.1 : 0.9)));
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      // Snapshot final positions so the next effect run (a graph or filter change) can reuse them
      // instead of re-throwing everything -- see Step 0.
      for (const n of nodes) prevPositions.set(n.id, n);
      cancelAnimationFrame(raf);
      removeEventListener("resize", onResize);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("wheel", onWheel);
      delete (canvas as unknown as { __graphProbe?: () => unknown }).__graphProbe;
    };
  }, [graph, hidden, roomsByNode, tallies]);

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
          {kinds.map((k) => {
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
          })}
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
