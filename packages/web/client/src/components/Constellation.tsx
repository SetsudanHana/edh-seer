import { useEffect, useRef } from "react";
import { displayName, tokenLabel, type EngineCard, type EngineModel, type Repeat } from "../lib/engine-model.js";
import type { OrbitModel, OrbitPartner } from "../lib/orbit-model.js";

/** THE DECK AS A MAP YOU WALK (owner, 2026-09-27: "go with constellation", after the orbit lab).
 *
 *  The orbit redrew one ring per card, so every step was a jump cut and nothing said where you had
 *  been ("you are completely losing sight of where have I been"). Here the cards live in ONE world:
 *  a card keeps its place once it has one, the view travels to the card you walk to, its partners
 *  bloom out around it into free space, the cards you walked through stay on the map with a gold
 *  route through them, and the older links stay drawn, faint. Ticks run along each line from the
 *  card that gives to the card that gains; with reduced motion, or paused, arrows carry that.
 *
 *  IMPERATIVE ON PURPOSE. A few dozen cards tween every frame, and routing that through React state
 *  would re-render the whole view sixty times a second. React owns the frame and the panel; this
 *  owns the SVG inside it, and is told what changed: the card in the middle, the trail, and which
 *  card is pointed at or picked. */

/** Partners drawn on the map for the card in the middle; the panel lists every one. A phone draws
 *  fewer, so their names still fit. */
export const MAP_CAP = 14;
export const mapCap = (narrow: boolean) => (narrow ? NARROW : WIDE).cap;
const SPEED: Record<Repeat, number> = { static: 70, triggered: 52, activated: 40, oneshot: 28 };
const RANK: Record<Repeat, number> = { static: 0, triggered: 1, activated: 2, oneshot: 3 };
const GOLD = "#D4A63A";
const NS = "http://www.w3.org/2000/svg";

/** One geometry per width. A phone's map is taller than wide, as the phone is. `aspect` is width
 *  over height and must match the frame's CSS aspect ratio. */
interface Geometry { aspect: number; cap: number; rings: number[]; step: number; minW: number; focusR: number; visitedR: number; partnerR: number; otherR: number }
const WIDE: Geometry = { aspect: 880 / 720, cap: MAP_CAP, rings: [230, 300], step: 300, minW: 900, focusR: 58, visitedR: 34, partnerR: 26, otherR: 18 };
const NARROW: Geometry = { aspect: 20 / 23, cap: 10, rings: [150, 210], step: 220, minW: 440, focusR: 44, visitedR: 28, partnerR: 24, otherR: 14 };

/** The partners the map draws for a card, strongest first, sectors in the report's order. */
export function mapPartners(o: OrbitModel, cap = MAP_CAP): { p: OrbitPartner; hue: string }[] {
  return o.sectors.flatMap((s) => s.partners.map((p) => ({ p, hue: s.hue })))
    .map((x, i) => ({ ...x, i, rank: Math.min(...x.p.links.map((l) => RANK[l.repeat])) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, cap)
    .sort((a, b) => a.i - b.i)
    .map(({ p, hue }) => ({ p, hue }));
}

interface Tween { from: Look; to: Look; t0: number; dur: number; delay: number }
interface Look { x: number; y: number; r: number; o: number; lo: number }
interface Node extends Look {
  id: string; card: EngineCard; g: SVGGElement; halo: SVGCircleElement; rim: SVGCircleElement; pip: SVGCircleElement; label: SVGTextElement;
  tw: Tween | null; glow: number; tglow: number; hue: string; dashed: boolean; homeR: number;
}
interface Edge {
  a: string; b: string; line: SVGLineElement; t1: SVGLineElement; t2: SVGLineElement; arrow: SVGPathElement;
  o: number; to: number; hue: string; from: string; both: boolean; dashed: boolean; speed: number; bright: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const pairKey = (a: string, b: string) => (a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`);
function make<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent?.appendChild(e);
  return e;
}
function shortName(c: EngineCard): string {
  const n = displayName(c);
  const front = n.split(" // ")[0]!;
  const comma = front.indexOf(",");
  return (comma > 0 && front.length > 18 ? front.slice(0, comma) : front) + (c.isToken ? " (token)" : "");
}

/** The engine behind the picture. One per mounted view; it outlives every change of middle card. */
class Sky {
  nodes = new Map<string, Node>();
  edges = new Map<string, Edge>();
  place = new Map<string, { x: number; y: number }>();
  cam = { x: 0, y: 0, w: 900 };
  camTw: { from: { x: number; y: number; w: number }; to: { x: number; y: number; w: number }; t0: number; dur: number } | null = null;
  focus = "";
  visited: string[] = [];
  lit: string | null = null;
  still = false;
  geo: Geometry = WIDE;
  move = 720;
  clock = 0;
  last = 0;
  raf = 0;
  drag = { on: false, moved: false, sx: 0, sy: 0, cx: 0, cy: 0 };
  constructor(public svg: SVGSVGElement, public layers: Record<"edges" | "ticks" | "nodes" | "labels" | "route", SVGGElement>,
    public card: (id: string) => EngineCard | undefined, public tap: (id: string) => void, public hover: (id: string | null) => void) {}

  now() { return typeof performance !== "undefined" ? performance.now() : Date.now(); }

  node(id: string): Node | null {
    const had = this.nodes.get(id);
    if (had) return had;
    const card = this.card(id);
    if (!card) return null;
    const g = make("g", { class: "constellation-node", role: "button", tabindex: 0, "aria-label": `${displayName(card)}${card.isToken ? ` ${tokenLabel(card)}` : ""}`, "data-id": id }, this.layers.nodes);
    const halo = make("circle", { r: 58, fill: "var(--accent)", opacity: 0, filter: "url(#constellation-glow)" }, g);
    make("circle", { r: 50, fill: "var(--surface-secondary)" }, g);
    if (card.art) make("image", { href: card.art, x: -50, y: -50, width: 100, height: 100, "clip-path": "url(#constellation-disc)", preserveAspectRatio: "xMidYMid slice" }, g);
    const rim = make("circle", { class: "constellation-rim", r: 50, fill: "none", stroke: "var(--muted)", "stroke-width": 4 }, g);
    const pip = make("circle", { r: 9, cx: 36, cy: -36, fill: GOLD, stroke: "var(--background)", "stroke-width": 4, opacity: 0 }, g);
    const label = make("text", { class: "constellation-label", "text-anchor": "middle" }, this.layers.labels);
    label.textContent = shortName(card);
    g.addEventListener("pointerenter", (e) => { if ((e as PointerEvent).pointerType === "mouse" && !this.drag.on) this.hover(id); });
    g.addEventListener("pointerleave", (e) => { if ((e as PointerEvent).pointerType === "mouse") this.hover(null); });
    g.addEventListener("click", (e) => { e.stopPropagation(); if (!this.drag.moved) this.tap(id); });
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.tap(id); } });
    const n: Node = { id, card, g, halo, rim, pip, label, x: 0, y: 0, r: 0, o: 0, lo: 0, tw: null, glow: 0, tglow: 0, hue: "var(--muted)", dashed: false, homeR: 0 };
    this.nodes.set(id, n);
    return n;
  }

  edge(a: string, b: string): Edge {
    const k = pairKey(a, b);
    let e = this.edges.get(k);
    if (!e) {
      const line = make("line", { "stroke-linecap": "round" }, this.layers.edges);
      const t1 = make("line", { stroke: "var(--foreground)", "stroke-linecap": "round", "stroke-dasharray": "4 12", "data-testid": "constellation-tick" }, this.layers.ticks);
      const t2 = make("line", { stroke: "var(--foreground)", "stroke-linecap": "round", "stroke-dasharray": "4 12", "data-testid": "constellation-tick" }, this.layers.ticks);
      const arrow = make("path", { d: "M6,0 L-4,-5 L-4,5 Z", "data-testid": "constellation-arrow" }, this.layers.ticks);
      e = { a, b, line, t1, t2, arrow, o: 0, to: 0, hue: "var(--muted)", from: a, both: false, dashed: false, speed: 40, bright: 0 };
      this.edges.set(k, e);
    }
    return e;
  }

  aim(n: Node, to: Partial<Look>, dur = this.move, delay = 0) {
    const from = { x: n.x, y: n.y, r: n.r, o: n.o, lo: n.lo };
    // Nothing moves when the reader asked for stillness: the card is simply where it goes.
    if (this.still) { Object.assign(n, from, to, { lo: to.lo ?? to.o ?? from.lo }); n.tw = null; return; }
    n.tw = { from, to: { ...from, ...to, lo: to.lo ?? to.o ?? from.lo }, t0: this.now(), dur: Math.max(dur, 1), delay };
  }

  camTo(x: number, y: number, w: number) {
    if (![x, y, w].every(Number.isFinite)) return;
    if (this.still) { this.cam = { x, y, w }; this.camTw = null; return; }
    this.camTw = { from: { ...this.cam }, to: { x, y, w }, t0: this.now(), dur: this.still ? 1 : this.move };
  }

  /** Motion turned off mid-way: everything goes straight to where it was heading. */
  settle() {
    for (const n of this.nodes.values()) if (n.tw) { Object.assign(n, n.tw.to); n.tw = null; }
    if (this.camTw) { this.cam = { ...this.camTw.to }; this.camTw = null; }
    for (const e of this.edges.values()) e.o = e.to;
    this.draw(this.now());
  }

  /** Where a new card goes: the free spot around `here` farthest from every card already placed. */
  freeSpot(here: { x: number; y: number }) {
    let best = here, bestD = -1;
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      for (const rr of this.geo.rings) {
        const pt = { x: here.x + Math.cos(a) * rr, y: here.y + Math.sin(a) * rr };
        let d = Infinity;
        for (const q of this.place.values()) d = Math.min(d, Math.hypot(q.x - pt.x, q.y - pt.y));
        if (d > bestD) { bestD = d; best = pt; }
      }
    }
    return best;
  }

  /** A new card in the middle. Cards already placed keep their place; the view travels. */
  walk(focus: string, prev: string | undefined, partners: { p: OrbitPartner; hue: string }[], visited: string[]) {
    this.focus = focus;
    this.visited = visited;
    const G = this.geo;
    const from = prev ? this.place.get(prev) : undefined;
    const here = this.place.get(focus) ?? (from ? { x: from.x, y: from.y - G.step } : { x: 0, y: 0 });
    this.place.set(focus, here);
    for (const { p } of partners) if (!this.place.has(p.card.id)) this.place.set(p.card.id, this.freeSpot(here));
    const seen = new Set(visited), around = new Set(partners.map(({ p }) => p.card.id));
    let fresh = 0;
    for (const [id, pos] of this.place) {
      const n = this.node(id);
      if (!n) continue;
      const isF = id === focus, isV = seen.has(id), isP = around.has(id);
      n.homeR = isF ? G.focusR : isV ? G.visitedR : isP ? G.partnerR : G.otherR;
      n.tglow = isF ? 0.5 : isV ? 0.18 : 0;
      const on = isF || isV || isP;
      const to = { x: pos.x, y: pos.y, r: n.homeR, o: on ? 1 : 0.35, lo: on ? 1 : 0 };
      if (n.o < 0.05) {
        // New to the map: grow out of the card you walked to, one after another.
        n.x = here.x; n.y = here.y; n.r = 4;
        this.aim(n, to, this.move * 0.8, this.move * 0.3 + fresh++ * 22);
      } else this.aim(n, to);
      if (isF) n.hue = "var(--foreground)";
    }
    for (const { p, hue } of partners) { const n = this.nodes.get(p.card.id); if (n && !seen.has(p.card.id)) { n.hue = hue; n.dashed = p.once; } }
    // A card you put in the middle wears the route's gold from then on.
    for (const id of visited) { const n = this.nodes.get(id); if (n && id !== focus) { n.hue = GOLD; n.dashed = false; } }
    // Links to earlier middles stay drawn, faint: the shape of where you have been.
    for (const e of this.edges.values()) e.to = e.to > 0 ? 0.22 : 0;
    for (const { p, hue } of partners) {
      const e = this.edge(focus, p.card.id);
      const rank = p.links.map((l) => l.repeat).sort((x, y) => RANK[x] - RANK[y])[0] ?? "triggered";
      const into = p.links.some((l) => l.to === focus), out = p.links.some((l) => l.from === focus);
      e.to = 1; e.hue = hue; e.dashed = p.once; e.speed = SPEED[rank];
      e.both = into && out; e.from = into && !out ? p.card.id : focus;
      const gives = e.from, gains = gives === focus ? p.card.id : focus;
      for (const el of [e.t1, e.arrow]) { el.setAttribute("data-from", gives); el.setAttribute("data-to", gains); }
      e.t2.setAttribute("data-from", gains); e.t2.setAttribute("data-to", gives);
    }
    this.fit([focus, ...partners.map(({ p }) => p.card.id)], 1.15);
    this.draw(this.now());
  }

  fit(ids: string[], pad = 1.2) {
    const pts = ids.map((i) => this.place.get(i)).filter((p): p is { x: number; y: number } => !!p);
    if (!pts.length) return;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs) - 80, maxX = Math.max(...xs) + 80, minY = Math.min(...ys) - 80, maxY = Math.max(...ys) + 100;
    this.camTo((minX + maxX) / 2, (minY + maxY) / 2, Math.max(this.geo.minW, Math.max(maxX - minX, (maxY - minY) * this.geo.aspect) * pad));
  }
  fitPath() { this.fit([...this.visited, this.focus, ...[...this.edges.values()].filter((e) => e.to >= 1).flatMap((e) => [e.a, e.b])], 1.1); }
  zoom(f: number) { this.camTo(this.cam.x, this.cam.y, Math.min(6000, Math.max(this.geo.minW * 0.6, this.cam.w * f))); }

  start() {
    const loop = (t: number) => { this.draw(t); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { cancelAnimationFrame(this.raf); }

  draw(t: number) {
    const dt = this.last ? Math.min(0.05, (t - this.last) / 1000) : 0;
    this.last = t; this.clock += dt;
    const kf = this.still ? 1 : 1 - Math.exp(-dt * 10);
    if (this.camTw) {
      const p = Math.min(1, (t - this.camTw.t0) / this.camTw.dur), e = ease(p), { from, to } = this.camTw;
      this.cam = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e };
      if (p >= 1) this.camTw = null;
    }
    const h = this.cam.w / this.geo.aspect;
    this.svg.setAttribute("viewBox", `${(this.cam.x - this.cam.w / 2).toFixed(1)} ${(this.cam.y - h / 2).toFixed(1)} ${this.cam.w.toFixed(1)} ${h.toFixed(1)}`);
    // Names stay the same size on screen at every zoom.
    const px = this.cam.w / Math.max(1, this.svg.getBoundingClientRect?.().width || 880);
    this.layers.labels.style.fontSize = `${(12 * px).toFixed(2)}px`;
    for (const n of this.nodes.values()) {
      if (n.tw) {
        const w = n.tw, p = Math.min(1, Math.max(0, (t - w.t0 - w.delay) / w.dur)), e = ease(p);
        n.x = w.from.x + (w.to.x - w.from.x) * e; n.y = w.from.y + (w.to.y - w.from.y) * e;
        n.r = w.from.r + (w.to.r - w.from.r) * e; n.o = w.from.o + (w.to.o - w.from.o) * e; n.lo = w.from.lo + (w.to.lo - w.from.lo) * e;
        if (p >= 1) n.tw = null;
      }
      const isF = n.id === this.focus, isLit = this.lit === n.id;
      const target = isLit && !isF ? n.homeR * 1.25 : null;
      if (target !== null && !n.tw) n.r += (target - n.r) * Math.max(kf, 0.3);
      else if (!isLit && !n.tw && Math.abs(n.r - n.homeR) > 0.1) n.r += (n.homeR - n.r) * Math.max(kf, 0.3);
      n.glow += ((isLit ? 0.5 : n.tglow) - n.glow) * Math.max(kf, 0.3);
      n.label.style.display = n.lo > 0.02 ? "" : "none";
      n.g.setAttribute("transform", `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)}) scale(${(Math.max(n.r, 0.1) / 50).toFixed(3)})`);
      n.g.setAttribute("opacity", n.o.toFixed(3));
      n.g.setAttribute("aria-pressed", String(isLit));
      n.rim.setAttribute("stroke", n.hue);
      n.rim.setAttribute("stroke-dasharray", n.dashed && !isF ? "10 8" : "none");
      n.rim.setAttribute("stroke-width", isF ? "3" : "5");
      n.halo.setAttribute("fill", isF ? "var(--accent)" : n.hue);
      n.halo.setAttribute("r", String(isF && !this.still ? 60 + 6 * Math.sin(this.clock * 1.4) : 58));
      n.halo.setAttribute("opacity", n.glow.toFixed(3));
      n.pip.setAttribute("opacity", this.visited.includes(n.id) && !isF ? "1" : "0");
      n.label.setAttribute("class", `constellation-label${isF ? " constellation-label-focus" : ""}`);
      n.label.setAttribute("x", n.x.toFixed(1));
      n.label.setAttribute("y", (n.y + n.r + (isF ? 24 : 16) * px).toFixed(1));
      n.label.setAttribute("opacity", (n.lo * n.o).toFixed(3));
    }
    this.cull(px);
    for (const e of this.edges.values()) {
      const A = this.nodes.get(e.a), B = this.nodes.get(e.b);
      const on = this.lit !== null && (e.a === this.lit || e.b === this.lit) && (e.a === this.focus || e.b === this.focus);
      e.o += (e.to - e.o) * kf; e.bright += ((on ? 1 : 0) - e.bright) * kf;
      const show = Math.min(e.o, A?.o ?? 0, B?.o ?? 0);
      const vis = show > 0.02 && !!A && !!B;
      e.line.style.display = vis ? "" : "none";
      e.t1.style.display = vis && !this.still ? "" : "none";
      e.t2.style.display = vis && !this.still && e.both ? "" : "none";
      e.arrow.style.display = vis && this.still ? "" : "none";
      if (!vis || !A || !B) continue;
      const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      const ax = A.x + ux * (A.r + 3), ay = A.y + uy * (A.r + 3), bx = B.x - ux * (B.r + 3), by = B.y - uy * (B.r + 3);
      const dim = this.lit && e.bright < 0.3 && e.o > 0.5 ? 0.35 : 1;
      e.line.setAttribute("x1", ax.toFixed(1)); e.line.setAttribute("y1", ay.toFixed(1));
      e.line.setAttribute("x2", bx.toFixed(1)); e.line.setAttribute("y2", by.toFixed(1));
      e.line.setAttribute("stroke", e.hue);
      e.line.setAttribute("stroke-width", (1.6 + e.bright * 1.8).toFixed(2));
      e.line.setAttribute("stroke-dasharray", e.dashed ? "6 6" : "none");
      e.line.setAttribute("opacity", (show * 0.8 * dim).toFixed(3));
      const fromA = e.from === e.a;
      if (this.still) {
        // No motion: an arrowhead halfway along says which way the link runs.
        const fwd = fromA ? 1 : -1, mx = (ax + bx) / 2, my = (ay + by) / 2;
        const deg = (Math.atan2(uy * fwd, ux * fwd) * 180) / Math.PI;
        e.arrow.setAttribute("transform", `translate(${mx.toFixed(1)} ${my.toFixed(1)}) rotate(${deg.toFixed(1)})`);
        e.arrow.setAttribute("fill", e.hue);
        e.arrow.setAttribute("opacity", (show * dim).toFixed(3));
        continue;
      }
      const off = (this.clock * e.speed * (1 + e.bright * 0.5)) % 16;
      const nx = -uy * 3, ny = ux * 3;
      const put = (ln: SVGLineElement, forward: boolean, shift: number) => {
        const [x1, y1, x2, y2] = forward ? [ax, ay, bx, by] : [bx, by, ax, ay];
        ln.setAttribute("x1", (x1 + nx * shift).toFixed(1)); ln.setAttribute("y1", (y1 + ny * shift).toFixed(1));
        ln.setAttribute("x2", (x2 + nx * shift).toFixed(1)); ln.setAttribute("y2", (y2 + ny * shift).toFixed(1));
        ln.setAttribute("stroke-dashoffset", (16 - off).toFixed(2));
        ln.setAttribute("stroke-width", (1.4 + e.bright * 1.2).toFixed(2));
        ln.setAttribute("opacity", (show * (0.42 + e.bright * 0.5) * dim).toFixed(3));
      };
      put(e.t1, fromA, e.both ? 1 : 0);
      if (e.both) put(e.t2, !fromA, -1);
    }
    // The route you walked, in gold, through every card you put in the middle.
    const pts = [...this.visited, this.focus].map((id) => this.nodes.get(id)).filter((n): n is Node => !!n);
    this.layers.route.replaceChildren();
    if (pts.length > 1) {
      const points = pts.map((n) => `${n.x.toFixed(1)},${n.y.toFixed(1)}`).join(" ");
      make("polyline", { points, fill: "none", stroke: GOLD, "stroke-width": 7, opacity: 0.2, "stroke-linejoin": "round", filter: "url(#constellation-soft)" }, this.layers.route);
      make("polyline", { points, fill: "none", stroke: GOLD, "stroke-width": 2.2, "stroke-dasharray": "2 7", "stroke-linecap": "round", opacity: 0.9, "data-testid": "constellation-route" }, this.layers.route);
    }
  }

  /** NO NAME PRINTED OVER ANOTHER. Names are placed in order of how much they matter (the middle,
   *  the card pointed at, the cards walked through, then the partners in the map's order); the
   *  first three always show, and a partner's name that would cover a name already placed, or another card's disc, is left off; its card still
   *  has its name on tap and in the panel. */
  cull(px: number) {
    const font = 12 * px;
    const rank = (n: Node) => (n.id === this.focus ? 0 : n.id === this.lit ? 1 : this.visited.includes(n.id) ? 2 : 3);
    const shown = [...this.nodes.values()].filter((n) => n.lo > 0.02).sort((a, b) => rank(a) - rank(b));
    type Box = { x0: number; x1: number; y0: number; y1: number };
    const hit = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
    const discs = [...this.nodes.values()].filter((n) => n.o > 0.3).map((n) => ({ id: n.id, x0: n.x - n.r, x1: n.x + n.r, y0: n.y - n.r, y1: n.y + n.r }));
    const kept: Box[] = [];
    for (const n of shown) {
      const f = n.id === this.focus ? font * 1.2 : font;
      const w = (n.label.textContent?.length ?? 0) * f * 0.56;
      const y = Number(n.label.getAttribute("y"));
      const b = { x0: n.x - w / 2, x1: n.x + w / 2, y0: y - f, y1: y + f * 0.25 };
      const ok = rank(n) < 3 || (!kept.some((k) => hit(b, k)) && !discs.some((d) => d.id !== n.id && hit(b, d)));
      n.label.style.display = ok ? "" : "none";
      if (ok) kept.push(b);
    }
  }

  /** Mouse drag pans the map; a touch scrolls the page, as a touch should. */
  bindDrag() {
    const svg = this.svg;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      this.drag = { on: true, moved: false, sx: e.clientX, sy: e.clientY, cx: this.cam.x, cy: this.cam.y };
    };
    const move = (e: PointerEvent) => {
      if (!this.drag.on) return;
      const dx = e.clientX - this.drag.sx, dy = e.clientY - this.drag.sy;
      if (!this.drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!this.drag.moved) { this.drag.moved = true; svg.classList.add("cursor-grabbing"); this.hover(null); }
      const k = this.cam.w / Math.max(1, svg.getBoundingClientRect().width);
      this.camTw = null; this.cam.x = this.drag.cx - dx * k; this.cam.y = this.drag.cy - dy * k;
    };
    const up = () => { if (!this.drag.on) return; this.drag.on = false; svg.classList.remove("cursor-grabbing"); setTimeout(() => { this.drag.moved = false; }, 0); };
    svg.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { svg.removeEventListener("pointerdown", down); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }
}

export function Constellation({ model, orbit, trail, lit, still, narrow, onTap, onHover }: {
  model: EngineModel; orbit: OrbitModel;
  /** The cards put in the middle before this one, oldest first. */
  trail: readonly string[];
  /** The card pointed at or picked: its lines brighten and the rest dim. */
  lit: string | null;
  /** Reduced motion or paused: nothing runs, arrows carry the direction. */
  still: boolean;
  narrow: boolean;
  onTap: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const layers = useRef<Record<string, SVGGElement | null>>({});
  const sky = useRef<Sky | null>(null);
  const handlers = useRef({ onTap, onHover });
  handlers.current = { onTap, onHover };

  useEffect(() => {
    const L = layers.current;
    const s = new Sky(svg.current!, L as Sky["layers"], (id) => model.cards.get(id), (id) => handlers.current.onTap(id), (id) => handlers.current.onHover(id));
    sky.current = s;
    const unbind = s.bindDrag();
    s.start();
    return () => { s.stop(); unbind(); for (const g of Object.values(L)) g?.replaceChildren(); sky.current = null; };
  }, [model]);

  useEffect(() => { const s = sky.current; if (s) { s.geo = narrow ? NARROW : WIDE; } }, [narrow]);
  useEffect(() => { const s = sky.current; if (s) { s.still = still; if (still) s.settle(); } }, [still]);

  useEffect(() => {
    const s = sky.current;
    if (!s) return;
    s.walk(orbit.focus.id, trail.at(-1), mapPartners(orbit, s.geo.cap), [...trail]);
    // `orbit` changes with its focus, and `trail` with it; both are read here, once per step.
  }, [orbit, trail, narrow]);

  useEffect(() => { const s = sky.current; if (s) { s.lit = lit; s.draw(s.now()); } }, [lit]);

  const name = displayName(orbit.focus);
  return (
    <div className="relative">
      <svg ref={svg} role="group" aria-label={`${name} and the ${orbit.direct + orbit.directTokens} cards it works with`}
        viewBox="-450 -368 900 736" className={`block h-auto w-full select-none touch-pan-y ${narrow ? "aspect-[20/23]" : "aspect-[880/720]"}`}>
        <defs>
          <clipPath id="constellation-disc" clipPathUnits="objectBoundingBox"><circle cx={0.5} cy={0.5} r={0.5} /></clipPath>
          <filter id="constellation-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="9" /></filter>
          <filter id="constellation-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" /></filter>
        </defs>
        <g ref={(el) => { layers.current.route = el; }} />
        <g ref={(el) => { layers.current.edges = el; }} />
        <g ref={(el) => { layers.current.ticks = el; }} />
        <g ref={(el) => { layers.current.nodes = el; }} />
        <g ref={(el) => { layers.current.labels = el; }} />
      </svg>
      <div className="absolute bottom-2 right-2 flex gap-1.5">
        {trail.length ? (
          <button type="button" className="min-h-11 rounded-full border border-(--separator) bg-(--surface) px-3 text-sm hover:border-(--foreground)" onClick={() => sky.current?.fitPath()}>
            See my path
          </button>
        ) : null}
        <button type="button" aria-label="Zoom in" className="min-h-11 min-w-11 rounded-full border border-(--separator) bg-(--surface) text-base hover:border-(--foreground)" onClick={() => sky.current?.zoom(0.75)}>+</button>
        <button type="button" aria-label="Zoom out" className="min-h-11 min-w-11 rounded-full border border-(--separator) bg-(--surface) text-base hover:border-(--foreground)" onClick={() => sky.current?.zoom(1.33)}>−</button>
      </div>
    </div>
  );
}
