import { useEffect, useMemo, useRef, useState } from "react";
import type { CardGraph, GraphNode, NodeKind } from "../types.js";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "./CardList.js";
import { glyphFor } from "./graph-glyphs.js";

/** Node kinds hidden on first paint. Each connects nearly every card in a deck -- `layout:normal`
 *  alone reaches 87 of Inalla's 94 -- so leaving them on makes the first thing anyone sees a
 *  starburst around a fact that distinguishes nothing. The same reason the engine IDF-weights
 *  common events: the hubs are where the information isn't. */
const DIM_BY_DEFAULT: NodeKind[] = ["layout", "cmc", "mana", "color"];

/** Kinds ordered for the filter row: the ones worth looking at first. */
const KIND_ORDER: NodeKind[] = [
  "event", "card", "subtype", "keyword", "token", "related",
  "type", "supertype", "power", "toughness", "face", "color", "mana", "cmc", "layout",
];

const TAU = Math.PI * 2;
/** Radius (world units) an art-filled card node draws at -- see Step 3 of the task brief. */
const ART_RADIUS = 14;
/** Glyphs are authored in a 24x24 box (see graph-glyphs.ts); half that is the box's own centre. */
const GLYPH_BOX_HALF = 12;

interface Sim extends GraphNode { x: number; y: number; vx: number; vy: number; deg: number }
type Point = { x: number; y: number };

/** Lay `roles` evenly around a ring of the given radius, centred on the origin. Pure and
 *  deterministic so it's testable without a canvas: each present functional role gets one anchor
 *  point that card nodes with that role spring weakly toward (Step 1). */
export function zoneCentroids(roles: string[], radius: number): Map<string, Point> {
  const centroids = new Map<string, Point>();
  roles.forEach((role, i) => {
    const angle = (i / roles.length) * TAU - Math.PI / 2;
    centroids.set(role, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  });
  return centroids;
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

export function GraphView({ graph }: { graph: CardGraph }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hidden, setHidden] = useState<Set<NodeKind>>(() => new Set(DIM_BY_DEFAULT));
  const [hover, setHover] = useState<{ label: string; kind: string; deg: number; x: number; y: number } | null>(null);

  // Layout continuity (Step 0): positions of every node as of the last time this effect tore
  // down, keyed by id. Persists across `graph`/`hidden` changes for the life of this component so
  // a re-render moves only what actually changed instead of re-throwing the whole layout.
  const prevPositionsRef = useRef<Map<string, Sim>>(undefined);
  prevPositionsRef.current ??= new Map();
  // Lazily-built Path2D cache for glyphs (Step 4). Built at stroke time, never at module load --
  // Path2D has no jsdom polyfill, see graph-glyphs.ts's doc comment.
  const pathCacheRef = useRef<Map<string, Path2D>>(undefined);
  pathCacheRef.current ??= new Map();
  // Art-crop image cache + a small concurrency-capped load queue (Step 3).
  const imgCacheRef = useRef<Map<string, HTMLImageElement | "error">>(undefined);
  imgCacheRef.current ??= new Map();
  const loadQueueRef = useRef<{ active: number; queue: string[] }>(undefined);
  loadQueueRef.current ??= { active: 0, queue: [] };

  const counts = useMemo(() => {
    const c = new Map<NodeKind, number>();
    for (const n of graph.nodes) c.set(n.kind, (c.get(n.kind) ?? 0) + 1);
    return c;
  }, [graph]);

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
    // Every card's roles, present-in-this-deck only, in the Cards tab's own order -- the ring
    // zones lay out on. Sized off the canvas' own footprint so the ring fits what's on screen.
    const presentRoles = CATEGORY_ORDER.filter((r) => graph.nodes.some((n) => n.roles?.includes(r)));
    const zoneRadius = Math.min(dim.w, dim.h) * 0.42;
    const zoneCentroid = zoneCentroids(presentRoles, zoneRadius);

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
          const d2 = dx * dx + dy * dy || 1;
          if (d2 > 220000) continue;
          const d = Math.sqrt(d2), f = 1400 / d2;
          dx = (dx / d) * f; dy = (dy / d) * f;
          a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
        }
      }
      for (const l of links) {
        if (!visible(l.s) || !visible(l.t)) continue;
        const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
        const d = Math.hypot(dx, dy) || 1, f = (d - 68) * 0.008;
        l.s.vx += (dx / d) * f; l.s.vy += (dy / d) * f;
        l.t.vx -= (dx / d) * f; l.t.vy -= (dy / d) * f;
      }
      // Zones bias the layout, they don't replace it: a weak spring per role toward that role's
      // ring anchor, added on top of the repulsion/edge springs above. A card with two roles feels
      // both and settles between them; a roleless card feels no zone force at all.
      for (const n of live) {
        if (n.kind !== "card" || !n.roles) continue;
        for (const role of n.roles) {
          const c = zoneCentroid.get(role);
          if (!c) continue;
          n.vx += (c.x - n.x) * 0.0009;
          n.vy += (c.y - n.y) * 0.0009;
        }
      }
      for (const n of live) {
        n.vx -= n.x * 0.0011; n.vy -= n.y * 0.0011;
        n.vx *= 0.86; n.vy *= 0.86;
        n.x += n.vx * alpha; n.y += n.vy * alpha;
      }
      alpha = Math.max(alpha * 0.995, 0.02);
    };

    const radius = (n: Sim) => (n.kind === "card" ? 3.5 : Math.min(3 + Math.sqrt(n.deg) * 1.5, 15));

    // Art loading (Step 3): lazy, capped concurrency, offline-first. `imgCache` only ever holds a
    // resolved `HTMLImageElement` or the literal "error" -- there is no third state that blocks
    // drawing, so a failed or unstarted load always falls through to today's dot.
    const imgCache = imgCacheRef.current!;
    const loadQueue = loadQueueRef.current!;
    const pump = () => {
      while (loadQueue.active < 8 && loadQueue.queue.length > 0) {
        const url = loadQueue.queue.shift()!;
        if (imgCache.has(url)) continue;
        loadQueue.active++;
        const img = new Image();
        img.onload = () => { imgCache.set(url, img); loadQueue.active--; pump(); };
        img.onerror = () => { imgCache.set(url, "error"); loadQueue.active--; pump(); };
        img.src = url;
      }
    };
    const requestImage = (url: string) => {
      if (imgCache.has(url) || loadQueue.queue.includes(url)) return;
      loadQueue.queue.push(url);
      pump();
    };

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

      // Zone chrome (Step 2): behind everything else -- a label and a radius-fitted hull per
      // present role, centred on that role's actual (live) member positions, not the fixed ring
      // anchor, so the hull tracks the cluster as it settles.
      const cardsWithRoles = nodes.filter((n) => visible(n) && n.kind === "card" && n.roles?.length);
      ctx.lineWidth = 1 / cam.z;
      ctx.strokeStyle = paint.sep;
      ctx.fillStyle = paint.muted;
      ctx.font = `500 ${11 / cam.z}px "JetBrains Mono", ui-monospace, monospace`;
      for (const role of presentRoles) {
        const members = cardsWithRoles.filter((n) => n.roles!.includes(role));
        if (members.length === 0) continue;
        let cx = 0, cy = 0;
        for (const m of members) { cx += m.x; cy += m.y; }
        cx /= members.length; cy /= members.length;
        let r = 40;
        for (const m of members) r = Math.max(r, Math.hypot(m.x - cx, m.y - cy) + 16);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
        ctx.fillText((CATEGORY_LABELS[role] ?? role).toUpperCase(), cx, cy - r - 6);
      }

      ctx.lineWidth = 0.7 / cam.z;
      ctx.strokeStyle = paint.sep;
      ctx.beginPath();
      for (const l of links) {
        if (!visible(l.s) || !visible(l.t)) continue;
        ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y);
      }
      ctx.stroke();

      for (const n of nodes) {
        if (!visible(n)) continue;

        if (n.kind === "card") {
          const img = n.artCrop ? imgCache.get(n.artCrop) : undefined;
          if (img && img !== "error") {
            ctx.save();
            ctx.beginPath(); ctx.arc(n.x, n.y, ART_RADIUS, 0, TAU); ctx.clip();
            ctx.drawImage(img, n.x - ART_RADIUS, n.y - ART_RADIUS, ART_RADIUS * 2, ART_RADIUS * 2);
            ctx.restore();
            ctx.lineWidth = 1 / cam.z;
            ctx.strokeStyle = paint.border;
            ctx.beginPath(); ctx.arc(n.x, n.y, ART_RADIUS, 0, TAU); ctx.stroke();
            continue;
          }
          // Onscreen diameter the art would render AT (ART_RADIUS), not today's placeholder dot --
          // the dot alone is already under 8px at rest zoom, which would starve every load. Below
          // ~8px zoomed out, the art would be mud anyway, so don't even start the request.
          if (n.artCrop && ART_RADIUS * cam.z * 2 >= 8) requestImage(n.artCrop);
          ctx.fillStyle = colorOf(n.kind);
          ctx.beginPath(); ctx.arc(n.x, n.y, radius(n), 0, TAU); ctx.fill();
          continue;
        }

        if (n.kind === "face") {
          ctx.fillStyle = colorOf(n.kind);
          ctx.beginPath(); ctx.arc(n.x, n.y, radius(n), 0, TAU); ctx.fill();
          continue;
        }

        // Every other kind draws its authored glyph instead of an abstract dot (Step 4).
        const scale = radius(n) / GLYPH_BOX_HALF;
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

      // Only hubs get labels, highest degree first, and a label is dropped when it would collide
      // with one already drawn. Without this the centre of a dense deck stacks four event names on
      // top of each other and none of them are readable.
      ctx.fillStyle = paint.fg;
      const fontPx = 11 / cam.z;
      ctx.font = `${fontPx}px ui-monospace, monospace`;
      const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
      const labelled = nodes
        .filter((n) => visible(n) && n.kind !== "card" && n.kind !== "face" && n.deg >= 6)
        .sort((a, b) => b.deg - a.deg);
      for (const n of labelled) {
        const x = n.x + radius(n) + 4;
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

    const onResize = () => { dim = size(); };
    addEventListener("resize", onResize);

    const pick = (ev: PointerEvent): Sim | null => {
      const r = canvas.getBoundingClientRect();
      const wx = (ev.clientX - r.left - dim.w / 2 - cam.x) / cam.z;
      const wy = (ev.clientY - r.top - dim.h / 2 - cam.y) / cam.z;
      let best: Sim | null = null, bd = 12 / cam.z;
      for (const n of nodes) {
        if (!visible(n)) continue;
        const d = Math.hypot(n.x - wx, n.y - wy);
        if (d < bd) { bd = d; best = n; }
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
      setHover(n ? { label: n.label, kind: n.kind, deg: n.deg, x: e.clientX - r.left, y: e.clientY - r.top } : null);
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
    };
  }, [graph, hidden]);

  const toggle = (k: NodeKind) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const kinds = KIND_ORDER.filter((k) => counts.has(k));

  return (
    <div className="flex flex-col gap-6">
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
      </div>

      <div className="relative rounded-(--radius) border border-(--border) overflow-hidden">
        <canvas
          ref={canvasRef}
          className="block w-full h-[380px] sm:h-[520px] cursor-grab touch-none"
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
          </div>
        ) : null}
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
