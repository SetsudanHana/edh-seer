import { useEffect, useMemo, useRef, useState } from "react";
import type { CardGraph, GraphNode, NodeKind } from "../types.js";

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

interface Sim extends GraphNode { x: number; y: number; vx: number; vy: number; deg: number }

export function GraphView({ graph }: { graph: CardGraph }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hidden, setHidden] = useState<Set<NodeKind>>(() => new Set(DIM_BY_DEFAULT));
  const [hover, setHover] = useState<{ label: string; kind: string; deg: number; x: number; y: number } | null>(null);

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
      surface: css.getPropertyValue("--surface").trim() || "#14171b",
    };
    /** Near-monochrome with one accent, matching the system's Restrained strategy: the event nodes
     *  are the point of this view and take the accent; cards read as foreground; everything a card
     *  merely HAS recedes to muted. A per-kind rainbow would be a second color system. */
    const colorOf = (k: NodeKind): string =>
      k === "event" ? paint.accent : k === "card" ? paint.fg : paint.muted;

    const nodes: Sim[] = graph.nodes.map((n, i) => ({
      ...n, x: Math.cos(i) * 260 + Math.random() * 30, y: Math.sin(i) * 260 + Math.random() * 30,
      vx: 0, vy: 0, deg: 0,
    }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links = graph.edges
      .map((e) => ({ s: byId.get(e.from), t: byId.get(e.to) }))
      .filter((l): l is { s: Sim; t: Sim } => Boolean(l.s && l.t));
    for (const l of links) { l.s.deg++; l.t.deg++; }

    const visible = (n: Sim) => !hidden.has(n.kind);
    let alpha = 1;
    const cam = { x: 0, y: 0, z: 1 };
    let raf = 0;
    let dragging: { x: number; y: number } | null = null;

    const size = () => {
      const dpr = devicePixelRatio;
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      return { w: r.width, h: r.height, dpr };
    };
    let dim = size();

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
      for (const n of live) {
        n.vx -= n.x * 0.0011; n.vy -= n.y * 0.0011;
        n.vx *= 0.86; n.vy *= 0.86;
        n.x += n.vx * alpha; n.y += n.vy * alpha;
      }
      alpha = Math.max(alpha * 0.995, 0.02);
    };

    const radius = (n: Sim) => (n.kind === "card" ? 3.5 : Math.min(3 + Math.sqrt(n.deg) * 1.5, 15));

    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = paint.surface;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(cam.z * dim.dpr, 0, 0, cam.z * dim.dpr,
        (dim.w / 2 + cam.x) * dim.dpr, (dim.h / 2 + cam.y) * dim.dpr);

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
        ctx.fillStyle = colorOf(n.kind);
        ctx.beginPath(); ctx.arc(n.x, n.y, radius(n), 0, Math.PI * 2); ctx.fill();
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
