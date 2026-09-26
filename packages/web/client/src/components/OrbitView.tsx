import { Fragment, useEffect, useMemo, useState } from "react";
import type { CardGraph, DeckReport } from "../types.js";
import { buildEngineModel, displayName, type EngineCard, type Repeat } from "../lib/engine-model.js";
import { buildOrbit, visiblePartners, type OrbitModel, type OrbitPartner, type OrbitSector } from "../lib/orbit-model.js";
import { ReasonText } from "./card-drawer.js";
import { Art, Badge, CardFace, Lines, ReadCards, RepeatKey, useNarrow } from "./engine-parts.js";

/** THE ONE-CARD VIEW AS AN ORBIT (graph evaluation 2026-09-25, design B; replaces `EgoView`).
 *
 *  A deterministic picture: the same card always draws the same way, with no simulation settling.
 *  The focus sits in the middle, the cards it works with around it in sectors by group, a solid line
 *  for a link that keeps working and a dashed one for a link that works once. The panel beside it
 *  says what the picture can't: the sentences, both cards' text, and the rest of the deck, as the
 *  cards one step further out and the ones that don't reach the focus at all.
 *
 *  A TAP READS, A SECOND TAP MOVES: the rule `EgoView` settled on, so a mis-aimed tap never throws
 *  the reader somewhere else. Where they have been is a trail above the picture, and the card they
 *  came from is a button at the top of the panel. */
export function OrbitView({ report, graph, focusId, onFocus, onBack }: {
  report: DeckReport; graph: CardGraph;
  focusId: string;
  onFocus: (id: string) => void;
  /** Leaves the view, where there is somewhere to go back to (the card list on a phone). */
  onBack?: () => void;
}) {
  const m = useMemo(() => buildEngineModel(report, graph), [report, graph]);
  const o = useMemo(() => buildOrbit(m, focusId), [m, focusId]);
  const narrow = useNarrow();
  const [sel, setSel] = useState<string | null>(null);
  const [sector, setSector] = useState<string | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const [arrival, setArrival] = useState<{ dx: number; dy: number } | null>(null);
  const still = useReducedMotion();
  const L = useMemo(() => (o ? layoutOrbit(o, narrow) : null), [o, narrow]);
  useEffect(() => { setSel(null); setSector(null); }, [focusId]);
  useEffect(() => {
    if (!onBack) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);
  if (!o || !L) return null;

  const centre = (id: string) => {
    if (id === focusId) return;
    const from = L.slots.find((x) => x.kind === "card" && x.p.card.id === id);
    setArrival(from ? { dx: from.x - L.cx, dy: from.y - L.cy } : null);
    setTrail((t) => [...t.filter((x) => x !== id), focusId].slice(-6));
    onFocus(id);
  };
  // One way back, a step at a time: a trail of names above the picture beside this button and
  // "Back to the card list" made three routes on one phone screen (orbit round 2).
  const back = (i: number) => {
    const id = trail[i]!;
    const from = L.slots.find((x) => x.kind === "card" && x.p.card.id === id);
    setArrival(from ? { dx: from.x - L.cx, dy: from.y - L.cy } : null);
    setTrail(trail.slice(0, i));
    onFocus(id);
  };
  const tap = (id: string) => {
    if (id === focusId) { setSel(null); setSector(null); return; }
    if (sel === id) centre(id);
    else { setSel(id); setSector(null); }
  };
  const focusName = displayName(o.focus);
  const selected = sel ? o.sectors.flatMap((s) => s.partners).find((p) => p.card.id === sel) : undefined;
  const openSector = sector !== null ? o.sectors.find((s) => sectorKey(s) === sector) : undefined;
  const prev = trail.length ? m.cards.get(trail[trail.length - 1]!) : undefined;

  return (
    <div className="flex flex-col gap-3 py-2">
      <nav aria-label="Cards you have centred" className="flex flex-wrap items-center gap-1 text-sm text-(--muted)">
        {onBack ? <button type="button" className="mr-2 min-h-11 rounded-(--radius) border border-(--separator) px-3" onClick={onBack}>Back to the card list</button> : null}
        <b className="text-(--foreground)" aria-current="page">{focusName}</b>
      </nav>
      {/* ON A WIDE SCREEN THE PICTURE TAKES THE ROOM: at 1920 the ring stopped at 880px and the
        * panel at 440px, leaving a third of the screen empty (owner, 2026-09-26). The ring fills
        * its column up to the screen's height, and the panel stays in view beside it. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-center lg:gap-8">
        {/* The ring's width follows the screen's height (the box is 880 by 720), so the whole ring
          * and its names stay on screen; the ring and panel sit together, centred. */}
        <div className="min-w-0 lg:w-[min(calc(100vw-38rem),calc((100svh-17rem)*1.2222))] lg:shrink-0">
          {/* Keyed by the card in the middle, so a new centre replays the ring flying out. */}
          <Orbit key={`${o.focus.id}|${narrow}`} o={o} L={L} narrow={narrow} sel={sel} sector={openSector ? sector : null} arrival={arrival} still={still} onTap={tap}
            onSector={(s) => { setSector(sectorKey(s)); setSel(null); }} />
        </div>
        <div key={`${o.focus.id}|${sel ?? ""}|${sector ?? ""}`} className="orbit-panel-in flex min-w-0 flex-col gap-3 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm lg:sticky lg:top-[calc(var(--site-header-h,0px)+var(--report-header-h,0px)+1rem)] lg:max-h-[calc(100svh-var(--site-header-h,0px)-var(--report-header-h,0px)-2rem)] lg:w-[min(34rem,40vw)] lg:shrink-0 lg:overflow-y-auto" aria-live="polite">
          {/* THE WAY BACK, WHERE THE EYE ALREADY IS: after centring a card, the only way back was a
            * word in the trail above the picture, which one seat never found and another called
            * "one word high" (orbit round 1). */}
          {prev && !selected && !openSector ? (
            <button type="button" className="min-h-11 self-start rounded-(--radius) border border-(--separator) px-3 hover:border-(--foreground)" onClick={() => back(trail.length - 1)}>
              ← Back to {displayName(prev)}
            </button>
          ) : null}
          {selected
            ? <PartnerPanel focus={o.focus} p={selected} onCentre={() => centre(selected.card.id)} onClose={() => setSel(null)} />
            : openSector
              ? <SectorPanel s={openSector} focus={o.focus} onPick={(id) => setSel(id)} onClose={() => setSector(null)} />
              : <Summary o={o} still={still} onSector={(s) => setSector(sectorKey(s))} onCentre={centre} />}
        </div>
      </div>
    </div>
  );
}

const sectorKey = (s: OrbitSector) => s.group?.tag ?? "";

/** "Inalla" for "Inalla, Archmage Ritualist"; a back face keeps whose back it is. */
/** Whether the reader asked for less motion, following changes. */
function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [still, setStill] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setStill(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return still;
}

function firstPart(c: EngineCard): string {
  const front = c.name.split(",")[0]!;
  return c.faceOf ? `${front} (back of ${c.faceOf.split(",")[0]})` : front;
}

/** "5 cards, 1 of them only once": "5, 1 only once" read as two numbers (orbit round 1). */
export function countText(n: number, once: number): string {
  const cards = `${n} card${n === 1 ? "" : "s"}`;
  if (!once) return cards;
  if (once === n) return n === 1 ? `${cards}, only once` : n === 2 ? `${cards}, both only once` : `${cards}, all only once`;
  return `${cards}, ${once} of them only once`;
}

/** A disc's name on at most two lines, cut only when it still doesn't fit. Before the comma, unless
 *  another card on the ring shares that part: two discs both read "Yuna" (orbit round 1). */
export function nameLines(c: EngineCard, clash: boolean, max: number): string[] {
  const base = clash ? c.name : c.name.split(",")[0]!;
  const cut = (t: string) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);
  // What the card IS never gets cut: a wrapped "Coruscation Mage (token)" lost its "(token)".
  const extra = c.isToken ? "(token)" : c.faceOf ? `(back of ${c.faceOf.split(",")[0]})` : "";
  if (extra) return [cut(base), cut(extra)];
  const lines: string[] = [];
  let cur = "";
  for (const w of base.split(/\s+/)) {
    if (!cur) cur = w;
    else if (`${cur} ${w}`.length <= max) cur = `${cur} ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  const out = lines.slice(0, 2).map(cut);
  if (lines.length > 2) out[1] = `${out[1]!.slice(0, max - 1).trimEnd()}…`;
  return out;
}

function Orbit({ o, L, narrow, sel, sector, arrival, still, onTap, onSector }: {
  o: OrbitModel; L: ReturnType<typeof layoutOrbit>; narrow: boolean; sel: string | null; sector: string | null;
  /** Where the card now in the middle was on the ring before, so it glides in from there. */
  arrival: { dx: number; dy: number } | null;
  /** The reader asked for reduced motion: nothing moves, and arrows carry the direction. */
  still: boolean;
  onTap: (id: string) => void; onSector: (s: OrbitSector) => void;
}) {
  const { W, H, cx, cy, R, r, fr, lineH, slots } = L;
  const clip = `orbit-clip-${narrow ? "n" : "w"}`;
  // What is lit: the tapped card, or every card of the tapped "+N" group (round 1: tapping "+14"
  // changed the panel and nothing on the picture).
  const lit = (card: string, s: OrbitSector) => (sel ? sel === card : sector !== null ? sectorKey(s) === sector : true);
  const dimming = sel !== null || sector !== null;
  // The discs fly out from the middle one after another, the whole ring in about half a second.
  const step = Math.min(24, 480 / Math.max(1, slots.length));
  const fly = (x: number, y: number, i: number) => ({ "--orbit-fx": `${cx - x}px`, "--orbit-fy": `${cy - y}px`, "--orbit-d": `${120 + i * step}ms` }) as React.CSSProperties;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${displayName(o.focus)} and the ${o.direct + o.directTokens} cards it works with`}
      className="block h-auto w-full select-none">
      <defs><clipPath id={clip} clipPathUnits="objectBoundingBox"><circle cx={0.5} cy={0.5} r={0.5} /></clipPath></defs>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--separator)" className="orbit-fade" />
      {slots.map((sl, i) => {
        if (sl.kind !== "card") return null;
        const on = lit(sl.p.card.id, sl.s);
        const dir = flowOf(sl.p, o.focus.id);
        return (
          <g key={`l-${sl.p.card.id}`} className="orbit-fade" style={{ "--orbit-d": `${60 + i * step}ms` } as React.CSSProperties}>
            <line x1={cx} y1={cy} x2={sl.x} y2={sl.y} stroke={sl.s.hue}
              strokeWidth={sel === sl.p.card.id ? 4 : sl.p.once ? 1.5 : 2.5} strokeDasharray={sl.p.once ? "5 5" : undefined} strokeOpacity={dimming && !on ? 0.2 : 0.75} />
            {still
              ? <Arrows x={sl.x} y={sl.y} cx={cx} cy={cy} r={r} fr={fr} dir={dir} hue={sl.s.hue} faint={dimming && !on} />
              : on ? <Flow x={sl.x} y={sl.y} cx={cx} cy={cy} r={r} fr={fr} dir={dir} hue={sl.s.hue} seed={i} strong={sel === sl.p.card.id} dot={narrow ? 2.6 : 3.2} /> : null}
          </g>
        );
      })}
      {!still ? (
        // The middle breathes: a slow ring, so the picture reads as live before anything is tapped.
        <circle cx={cx} cy={cy} r={fr + 4} fill="none" stroke="var(--foreground)" strokeWidth={1.5} opacity={0} pointerEvents="none">
          <animate attributeName="r" values={`${fr + 4};${fr + 26}`} dur="3.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.35;0" dur="3.2s" repeatCount="indefinite" />
        </circle>
      ) : null}
      {slots.map((sl, i) => {
        const { x, y } = sl;
        if (sl.kind === "more") {
          const on = sector === sectorKey(sl.s);
          return (
            <g key={`m-${sl.s.name}`} transform={`translate(${x},${y})`} role="button" tabIndex={0} className={DISC}
              aria-label={`${sl.n} more: ${sl.s.name}${sl.once ? `, ${sl.once} of them only once` : ""}`} aria-pressed={on} opacity={dimming && !on ? 0.45 : 1}
              onClick={() => onSector(sl.s)} onKeyDown={key(() => onSector(sl.s))}>
              <g className="orbit-body orbit-fly" style={fly(x, y, i)}>
                <circle className="orbit-ring" r={r} fill="var(--surface-secondary)" stroke={sl.s.hue} strokeWidth={on ? 4 : 2} />
                <text textAnchor="middle" dy={5} fontSize={narrow ? 13 : 14} fill="var(--foreground)">+{sl.n}</text>
              </g>
            </g>
          );
        }
        const { card } = sl.p;
        const on = lit(card.id, sl.s);
        return (
          <g key={card.id} transform={`translate(${x},${y})`} role="button" tabIndex={0} className={DISC}
            aria-label={`${displayName(card)}${card.isToken ? " (token)" : ""}`} aria-pressed={sel === card.id}
            opacity={dimming && !on ? 0.45 : 1} onClick={() => onTap(card.id)} onKeyDown={key(() => onTap(card.id))}>
            <g className="orbit-body orbit-fly" style={fly(x, y, i)}>
              <circle className="orbit-ring" r={r + 2} fill="var(--background)" stroke={sl.s.hue} strokeWidth={sel === card.id || (sector !== null && on) ? 4 : 2} strokeDasharray={card.isToken ? "3 3" : undefined} />
              {card.art ? <image href={card.art} x={-r} y={-r} width={2 * r} height={2 * r} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" /> : null}
              <text x={sl.lx} y={sl.ly} textAnchor={sl.anchor} fontSize={narrow ? 13 : 12} fill="var(--foreground)" paintOrder="stroke" stroke="var(--background)" strokeWidth={4} strokeLinejoin="round">
                {sl.lines.map((l, j) => <tspan key={j} x={sl.lx} dy={j ? lineH : 0}>{l}</tspan>)}
              </text>
            </g>
          </g>
        );
      })}
      <g transform={`translate(${cx},${cy})`} role="button" tabIndex={0} className={DISC} aria-label={`${displayName(o.focus)}, in the middle`}
        onClick={() => onTap(o.focus.id)} onKeyDown={key(() => onTap(o.focus.id))}>
        {/* A centred card glides in from where its disc was on the ring. */}
        <g className="orbit-fly orbit-arrive" style={{ "--orbit-fx": `${arrival?.dx ?? 0}px`, "--orbit-fy": `${arrival?.dy ?? 0}px`, "--orbit-d": "0ms" } as React.CSSProperties}>
          <circle className="orbit-ring" r={fr + 3} fill="var(--background)" stroke="var(--foreground)" strokeWidth={3} />
          {o.focus.art ? <image href={o.focus.art} x={-fr} y={-fr} width={2 * fr} height={2 * fr} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" /> : null}
          <text y={fr + 20} textAnchor="middle" fontSize={narrow ? 13 : 15} fontWeight={600} fill="var(--foreground)" paintOrder="stroke" stroke="var(--background)" strokeWidth={5} strokeLinejoin="round">
            {firstPart(o.focus)}
          </text>
        </g>
      </g>
    </svg>
  );
}

/** Which way a partner's lines run: into the middle (it feeds the focus), out of it, or both. */
export function flowOf(p: OrbitPartner, focus: string): { in: boolean; out: boolean; repeat: Repeat } {
  const rank: Record<Repeat, number> = { static: 0, triggered: 1, activated: 2, oneshot: 3 };
  const repeat = p.links.map((l) => l.repeat).sort((a, b) => rank[a] - rank[b])[0] ?? "triggered";
  return { in: p.links.some((l) => l.to === focus), out: p.links.some((l) => l.from === focus), repeat };
}

/** How often a dot sets off, by how often the link works: a steady stream for always on, a beat for
 *  every time, a slower one for on demand, and a lone dot now and then for once. */
const PERIOD: Record<Repeat, number> = { static: 1, triggered: 1.9, activated: 2.6, oneshot: 6 };
const SPEED = 110;

/** THE EVENTS, MOVING (owner, 2026-09-26: "I really liked the animations of events flowing out or
 *  in"). Dots travel along the spoke from the card that gives to the card that gains, the way the
 *  board's dashes crawled. SMIL, not a frame loop: the browser runs it, and a ring of twenty spokes
 *  costs no script. */
function Flow({ x, y, cx, cy, r, fr, dir, hue, seed, strong, dot }: {
  x: number; y: number; cx: number; cy: number; r: number; fr: number;
  dir: ReturnType<typeof flowOf>; hue: string; seed: number; strong: boolean; dot: number;
}) {
  const len = Math.hypot(x - cx, y - cy);
  const ux = (x - cx) / len, uy = (y - cy) / len;
  const inner = { x: cx + ux * (fr + 6), y: cy + uy * (fr + 6) }, outer = { x: x - ux * (r + 5), y: y - uy * (r + 5) };
  const travel = Math.hypot(outer.x - inner.x, outer.y - inner.y) / (strong ? SPEED * 1.4 : SPEED);
  const period = Math.max(travel, travel * PERIOD[dir.repeat] * (strong ? 0.6 : 1));
  const f = travel / period;
  const dots: { path: string; begin: number }[] = [];
  const add = (a: typeof inner, b: typeof inner, offset: number) => {
    const n = dir.repeat === "static" ? 2 : 1;
    for (let k = 0; k < n; k++) dots.push({ path: `M${a.x},${a.y} L${b.x},${b.y}`, begin: -(((seed * 0.53 + offset) % 1) * period + (k * period) / n) });
  };
  if (dir.in) add(outer, inner, 0);
  if (dir.out) add(inner, outer, 0.5);
  return (
    <g pointerEvents="none">
      {dots.map((d, k) => (
        <circle key={k} r={strong ? dot * 1.4 : dot} fill={hue} stroke="var(--background)" strokeWidth={1} opacity={0}>
          <animateMotion path={d.path} dur={`${period}s`} begin={`${d.begin}s`} repeatCount="indefinite" keyPoints="0;1;1" keyTimes={`0;${f};1`} calcMode="linear" />
          <animate attributeName="opacity" values="0;1;1;0;0" keyTimes={`0;${f * 0.12};${f * 0.85};${f};1`} dur={`${period}s`} begin={`${d.begin}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </g>
  );
}

/** With motion off, the direction is an arrowhead partway along the spoke. */
function Arrows({ x, y, cx, cy, r, fr, dir, hue, faint }: {
  x: number; y: number; cx: number; cy: number; r: number; fr: number; dir: ReturnType<typeof flowOf>; hue: string; faint: boolean;
}) {
  const len = Math.hypot(x - cx, y - cy);
  const ux = (x - cx) / len, uy = (y - cy) / len;
  const at = (t: number, towardCentre: boolean) => {
    const d = fr + (len - fr - r) * t;
    const px = cx + ux * d, py = cy + uy * d;
    const deg = (Math.atan2(uy, ux) * 180) / Math.PI + (towardCentre ? 180 : 0);
    return <path key={`${t}${towardCentre}`} d="M5,0 L-4,-4 L-4,4 Z" fill={hue} opacity={faint ? 0.3 : 0.95} transform={`translate(${px},${py}) rotate(${deg})`} />;
  };
  return (
    <g pointerEvents="none" data-testid="orbit-arrows">
      {dir.in ? at(dir.out ? 0.4 : 0.5, true) : null}
      {dir.out ? at(dir.in ? 0.62 : 0.5, false) : null}
    </g>
  );
}

/** No browser outline on a disc: SVG draws it as a box around the name. A keyboard focus
 *  thickens the disc's own ring instead. */
const DISC = "orbit-disc group cursor-pointer outline-none [&_.orbit-ring]:group-focus-visible:stroke-(--accent) [&_.orbit-ring]:group-focus-visible:[stroke-width:5]";

type Slot = { x: number; y: number; a: number } & (
  | { kind: "card"; p: OrbitPartner; s: OrbitSector; lines: string[]; lx: number; ly: number; anchor: "start" | "middle" | "end" }
  | { kind: "more"; n: number; s: OrbitSector; once: number }
);

/** WHERE EVERYTHING GOES, the same every time for the same card. The ring holds as many discs as
 *  fit with a gap between them; the rest are counted on each sector's "+N". Names go outside
 *  their disc on up to two lines, and a name that would overlap one already placed moves a line
 *  further out. */
export function layoutOrbit(o: OrbitModel, narrow: boolean) {
  // One geometry per width rather than one scaled down: at 390px a 720 box drew 6px names.
  const W = narrow ? 452 : 880, H = narrow ? 470 : 720;
  const cx = W / 2, cy = H / 2;
  const R = narrow ? 112 : 228, r = narrow ? 17 : 25, fr = narrow ? 34 : 58;
  // A phone gets more room between discs: at 390px twenty discs touched (orbit round 1).
  const lineMax = narrow ? 12 : 16, charW = narrow ? 8 : 7, lineH = narrow ? 15 : 14, pitch = 2 * r + (narrow ? 20 : 10);
  const room = Math.floor((2 * Math.PI * R) / pitch);
  // No empty slot between sectors on a phone: there the gaps left five discs of fourteen slots,
  // and the colours already tell the groups apart.
  const gaps = !narrow && o.sectors.length > 1 ? o.sectors.length : 0;
  let cap = room - gaps;
  let vis = visiblePartners(o, cap);
  for (let used = count(vis, gaps); used > room && cap > 1; used = count(vis, gaps)) vis = visiblePartners(o, --cap);
  type Raw = { kind: "gap" } | { kind: "card"; p: OrbitPartner; s: OrbitSector } | { kind: "more"; n: number; s: OrbitSector; once: number };
  const raw: Raw[] = [];
  for (const v of vis) {
    if (raw.length && gaps) raw.push({ kind: "gap" });
    for (const p of v.shown) raw.push({ kind: "card", p, s: v.sector });
    if (v.hidden) raw.push({ kind: "more", n: v.hidden, s: v.sector, once: v.hiddenOnce });
  }
  if (gaps) raw.push({ kind: "gap" });
  const firsts = new Map<string, number>();
  for (const sl of raw) if (sl.kind === "card") { const f = sl.p.card.name.split(",")[0]!; firsts.set(f, (firsts.get(f) ?? 0) + 1); }
  if (firsts.has(o.focus.name.split(",")[0]!)) firsts.set(o.focus.name.split(",")[0]!, 2);
  const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const hit = (b: (typeof boxes)[number]) => boxes.some((o2) => b.x0 < o2.x1 && b.x1 > o2.x0 && b.y0 < o2.y1 && b.y1 > o2.y0);
  const slots: Slot[] = [];
  raw.forEach((sl, i) => {
    if (sl.kind === "gap") return;
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, raw.length);
    const ca = Math.cos(a), sa = Math.sin(a);
    const x = cx + R * ca, y = cy + R * sa;
    if (sl.kind === "more") { slots.push({ ...sl, x, y, a }); return; }
    const lines = nameLines(sl.p.card, (firsts.get(sl.p.card.name.split(",")[0]!) ?? 0) > 1, lineMax);
    const w = Math.max(...lines.map((l) => l.length)) * charW;
    const h = lines.length * lineH;
    // Near the top and bottom a name sits above or below its disc; at the sides, beside it.
    const vertical = Math.abs(ca) <= 0.5;
    const anchor = vertical ? "middle" : ca > 0 ? "start" : "end";
    // `ly` is the first line's baseline.
    let lx = vertical ? 0 : (r + 6) * ca;
    let ly = vertical ? (sa > 0 ? r + 16 : -(r + 8) - (lines.length - 1) * lineH) : (r + 6) * sa + 4 - ((lines.length - 1) * lineH) / 2;
    const box = () => {
      const ax = x + lx, ay = y + ly;
      const x0 = anchor === "start" ? ax : anchor === "end" ? ax - w : ax - w / 2;
      return { x0, x1: x0 + w, y0: ay - lineH + 3, y1: ay - lineH + 3 + h };
    };
    for (let k = 0; k < 4 && hit(box()); k++) {
      if (vertical) ly += Math.sign(sa) * lineH; else { lx += ca * 10; ly += sa * lineH; }
    }
    // Inside the box: at 390px a left-hand name printed as "chaeoman…".
    { const b = box(); if (b.x0 < 2) lx += 2 - b.x0; else if (b.x1 > W - 2) lx -= b.x1 - (W - 2); }
    boxes.push(box());
    slots.push({ ...sl, x, y, a, lines, lx, ly, anchor });
  });
  return { W, H, cx, cy, R, r, fr, lineH, slots };
}

function count(vis: ReturnType<typeof visiblePartners>, gaps: number): number {
  return gaps + vis.reduce((t, v) => t + v.shown.length + (v.hidden ? 1 : 0), 0);
}

const key = (f: () => void) => (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); f(); } };

/** One "Through X" group. Each name opens its own line and both cards' text: one example sentence
 *  over 25 names could not be checked (orbit round 2). */
function Through({ t, onCentre }: { t: OrbitModel["through"][number]; onCentre: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const card = open ? t.cards.find((c) => c.id === open) : undefined;
  const lines = card ? (t.lines.get(card.id) ?? []) : [];
  return (
    <li className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <Art card={t.via} size={28} />
        <span className="flex-1">Through <b>{displayName(t.via)}</b> <span className="text-(--muted)">({t.cards.length})</span></span>
        <button type="button" className="min-h-9 shrink-0 rounded-(--radius) border border-(--separator) px-2 text-xs" onClick={() => onCentre(t.via.id)}>Put it in the middle</button>
      </span>
      {t.example && !card ? <span className="text-xs text-(--muted)"><Badge repeat={t.example.repeat} /><ReasonText text={t.example.text} /></span> : null}
      {/* The answer opens right under the name tapped: below the whole list it landed ~460px from
        * the thumb on a phone (orbit round 3). A full-width box breaks the wrapped line there. */}
      <span className="flex flex-wrap gap-x-2 gap-y-0.5">
        {t.cards.map((c, i) => (
          <Fragment key={c.id}>
            <button type="button" aria-expanded={open === c.id} className={`min-h-9 text-left hover:underline ${open === c.id ? "font-semibold text-(--accent)" : ""}`} onClick={() => setOpen(open === c.id ? null : c.id)}>
              {displayName(c)}{i < t.cards.length - 1 ? "," : ""}
            </button>
            {card && open === c.id ? (
              <div className="my-1 flex w-full flex-col gap-1.5 rounded-(--radius) border border-(--separator) bg-(--background) p-2">
                <Lines links={lines} />
                <ReadCards cards={[t.via, card]} />
                <button type="button" className="min-h-9 self-start rounded-(--radius) border border-(--separator) px-2 text-xs" onClick={() => onCentre(card.id)}>Put {firstPart(card)} in the middle</button>
              </div>
            ) : null}
          </Fragment>
        ))}
      </span>
    </li>
  );
}

function Summary({ o, still, onSector, onCentre }: { o: OrbitModel; still: boolean; onSector: (s: OrbitSector) => void; onCentre: (id: string) => void }) {
  const name = displayName(o.focus);
  const first = firstPart(o.focus);
  return (
    <>
      <div className="flex items-start gap-3">
        <CardFace card={o.focus} className="w-24" />
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-base">{name}</h3>
          <p className="text-(--muted)">
            {o.direct + o.directTokens === 0
              ? "Nothing else in the deck works with this card."
              : <>Works with <b className="text-(--foreground)">{o.direct} card{o.direct === 1 ? "" : "s"}</b>{o.directTokens ? <> and {o.directTokens} token{o.directTokens === 1 ? "" : "s"}</> : null}. Tap one to read how; tap it again to put it in the middle.</>}
          </p>
        </div>
      </div>
      {o.sectors.length ? (
        <ul className="flex flex-col gap-1">
          {o.sectors.map((s) => (
            <li key={s.name}>
              <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-(--radius) px-1 text-left hover:bg-(--surface-secondary)" onClick={() => onSector(s)}>
                <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.hue }} />
                <span className="flex-1">{s.name}</span>
                <span className="text-(--muted) whitespace-nowrap">{countText(s.partners.length, s.partners.filter((p) => p.once).length)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-(--muted)">{still ? "Arrows point" : "Dots travel"} from the card that gives to the card that gains. A solid line keeps working; a dashed line works only once. A dashed ring is a token. A "+" disc holds the rest of its group: tap it for the list.</p>
      <ReadCards cards={[o.focus]} />
      {o.through.length ? (
        <details>
          <summary className="cursor-pointer py-1.5">
            <b>{o.near.length} more card{o.near.length === 1 ? "" : "s"}</b> work with a card around {first}, but not with {first} itself
          </summary>
          <ul className="mt-2 flex flex-col gap-3">
            {o.through.map((t) => <Through key={t.via.id} t={t} onCentre={onCentre} />)}
          </ul>
        </details>
      ) : null}
      {o.far.length ? (
        <details>
          <summary className="cursor-pointer py-1.5">
            <b>{o.far.length} card{o.far.length === 1 ? "" : "s"}</b> don't connect to {first}, even through another card
          </summary>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {o.far.map((card) => (
              <li key={card.id}><button type="button" className="min-h-9 text-left hover:underline" onClick={() => onCentre(card.id)}>{displayName(card)}</button></li>
            ))}
          </ul>
        </details>
      ) : (
        // An empty list said nothing, and a missing list read as a hole (orbit round 1). Lands are
        // counted apart: "every other nonland card" beside lists full of lands read as a
        // contradiction (round 2).
        <p className="text-(--muted)">
          {o.farLands
            ? <>Every other card in the deck connects to {first}, directly or through a card around it, except {o.farLands} land{o.farLands === 1 ? "" : "s"}.</>
            : <>Every other card in the deck connects to {first}, directly or through a card around it.</>}
        </p>
      )}
      {o.far.length && o.farLands ? <p className="text-xs text-(--muted)">{o.farLands} land{o.farLands === 1 ? " doesn't" : "s don't"} connect either, which is normal for a land.</p> : null}
    </>
  );
}

function SectorPanel({ s, focus, onPick, onClose }: { s: OrbitSector; focus: EngineCard; onPick: (id: string) => void; onClose: () => void }) {
  const partnerOf = (l: OrbitPartner["links"][number]) => (l.from === focus.id ? l.to : l.from);
  return (
    <>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.hue }} />
        <h3 className="flex-1 font-semibold text-base">{s.name}</h3>
        <button type="button" className="min-h-11 rounded-(--radius) border border-(--separator) px-3" onClick={onClose}>Back</button>
      </div>
      <p className="text-(--muted)">The {countText(s.partners.length, s.partners.filter((p) => p.once).length)} here that work with {displayName(focus)}. Tap one for every line and both cards' text.</p>
      <ul className="flex flex-col gap-1">
        {sameLine(s.partners, partnerOf).map((row) => row.cards.length > 2 ? (
          // ONE SENTENCE, MANY NAMES: fifteen rows of "When X enters because Inalla copies it…"
          // with only the name changing read as a wall (orbit round 2).
          <li key={row.key} className="flex flex-col gap-1 rounded-(--radius) border border-(--separator) p-2">
            <span className="text-xs text-(--muted)"><Badge repeat={row.repeat} />{row.sentence}</span>
            <span className="flex flex-wrap gap-x-2 gap-y-1">
              {row.cards.map((p) => (
                <button key={p.card.id} type="button" className="flex min-h-9 items-center gap-1.5 rounded-(--radius) px-1 text-left hover:bg-(--surface-secondary)" onClick={() => onPick(p.card.id)}>
                  <Art card={p.card} size={24} />{displayName(p.card)}{p.card.isToken ? <span className="text-(--muted)"> (token)</span> : null}
                </button>
              ))}
            </span>
          </li>
        ) : row.cards.map((p) => {
          const l = p.links.find((x) => partnerOf(x) === p.card.id) ?? p.links[0];
          return (
            <li key={p.card.id}>
              <button type="button" className="flex min-h-11 w-full items-start gap-2 rounded-(--radius) px-1 py-1 text-left hover:bg-(--surface-secondary)" onClick={() => onPick(p.card.id)}>
                <Art card={p.card} size={32} />
                <span className="flex flex-1 flex-col">
                  <span>{displayName(p.card)}{p.card.isToken ? <span className="text-(--muted)"> (token)</span> : null}</span>
                  {l ? <span className="text-xs text-(--muted)"><Badge repeat={l.repeat} /><ReasonText text={l.text} /></span> : null}
                </span>
              </button>
            </li>
          );
        }))}
      </ul>
    </>
  );
}

/** Partners whose first line is the same sentence with only their own name changed, grouped. The
 *  sentence keeps its shape with the name swapped for "one of these". */
export function sameLine(partners: OrbitPartner[], partnerOf: (l: OrbitPartner["links"][number]) => string) {
  const rows = new Map<string, { key: string; sentence: string; repeat: OrbitPartner["links"][number]["repeat"]; cards: OrbitPartner[] }>();
  for (const p of partners) {
    const l = p.links.find((x) => partnerOf(x) === p.card.id) ?? p.links[0];
    const shape = l ? `${l.repeat}|${l.text.split(p.card.name).join("\u0000")}` : `solo|${p.card.id}`;
    if (!rows.has(shape)) rows.set(shape, { key: shape, sentence: l ? l.text.split(p.card.name).join("one of these") : "", repeat: l?.repeat ?? "triggered", cards: [] });
    rows.get(shape)!.cards.push(p);
  }
  return [...rows.values()];
}

function PartnerPanel({ focus, p, onCentre, onClose }: { focus: EngineCard; p: OrbitPartner; onCentre: () => void; onClose: () => void }) {
  return (
    <>
      <div className="flex items-start gap-2">
        <CardFace card={focus} className="w-20" />
        <CardFace card={p.card} className="w-20" />
        <button type="button" aria-label="Close" className="ml-auto flex min-h-11 min-w-11 items-center justify-center rounded-(--radius) border border-(--separator) text-lg" onClick={onClose}>✕</button>
      </div>
      <h3 className="font-semibold text-base">{displayName(focus)} and {displayName(p.card)}{p.card.isToken ? <span className="text-(--muted) font-normal"> (token)</span> : null}</h3>
      <Lines links={p.links.slice(0, 6)} />
      {p.links.length > 6 ? <p className="text-(--muted)">…and {p.links.length - 6} more lines between them.</p> : null}
      <ReadCards cards={[focus, p.card]} />
      <details className="text-xs text-(--muted)"><summary className="cursor-pointer">What the labels mean</summary><div className="mt-1"><RepeatKey /></div></details>
      <button type="button" className="min-h-11 self-start rounded-(--radius) border border-(--accent) px-4 text-(--accent)" onClick={onCentre}>Put {firstPart(p.card)} in the middle</button>
    </>
  );
}
