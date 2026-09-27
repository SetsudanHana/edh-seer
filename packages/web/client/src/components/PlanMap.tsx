import { useId, useState } from "react";
import type { EngineCard, EngineModel } from "../lib/engine-model.js";
import { useCardDrawer } from "./card-drawer.js";
import { useNarrow } from "./engine-parts.js";

/** One geometry per width. On a phone the ring is taller than wide, as the phone is, and draws
 *  fewer cards, so every name still fits under its card. */
const WIDE = { w: 640, h: 460, rx: 240, ry: 165, cap: 16, outerR: 20, midR: 30, spread: 62, font: 12, chars: 14 };
const NARROW = { w: 360, h: 470, rx: 122, ry: 170, cap: 10, outerR: 17, midR: 26, spread: 56, font: 11, chars: 12 };

/** A name in at most two lines of about `chars` characters, ellipsised past that. */
function lines(name: string, chars: number): string[] {
  const front = name.split(" // ")[0]!;
  const out: string[] = [];
  let cur = "";
  for (const word of front.split(" ")) {
    if (cur && (cur + " " + word).length > chars) { out.push(cur); cur = word; } else cur = cur ? `${cur} ${word}` : word;
  }
  out.push(cur);
  if (out.length <= 2) return out;
  const second = out.slice(1).join(" ");
  return [out[0]!, second.length > chars ? `${second.slice(0, chars - 1).trimEnd()}…` : second];
}

/** THE PLAN AS A MAP (report cohesion audit, 2026-09-27: "rely more on data visualisation than the
 *  text"). The cards that turn the plan into a win sit in the middle; with none named, the
 *  commander does. The plan's other cards ring them, and a line joins two cards the engine read a
 *  link between. A card with no line is dashed: a ringed card that works with none of the cards
 *  that finish the plan, or a finisher nothing on the plan works with. Tapping a card opens it. */
export function PlanMap({ model, middle, around }: { model: EngineModel; middle: string[]; around: string[] }) {
  const narrow = useNarrow();
  const g = narrow ? NARROW : WIDE;
  // useId gives ":r1:"; colons break url(#...).
  const clip = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const { open } = useCardDrawer();
  const [lit, setLit] = useState<string | null>(null);
  const byName = new Map<string, EngineCard>();
  for (const c of model.cards.values()) if (!c.isFace && !c.isToken && !byName.has(c.name)) byName.set(c.name, c);
  const mids = middle.map((n) => byName.get(n)).filter((c): c is EngineCard => !!c).slice(0, 3);
  if (!mids.length) return null;
  const midIds = new Set(mids.map((c) => c.id));
  const linked = (a: EngineCard, b: EngineCard) => !!model.partners.get(a.id)?.has(b.id);
  const ring = around.map((n) => byName.get(n)).filter((c): c is EngineCard => !!c && !midIds.has(c.id));
  // Cards joined to the middle first, grouped by the middle card they join, so lines cross less;
  // the cards that join none go last.
  const firstMid = (c: EngineCard) => { const i = mids.findIndex((m) => linked(c, m)); return i < 0 ? mids.length : i; };
  const shown = ring.map((c, i) => ({ c, i, k: firstMid(c) })).sort((a, b) => a.k - b.k || a.i - b.i).slice(0, g.cap).map((x) => x.c);
  const cx = g.w / 2, cy = g.h / 2 - 14;
  const at = new Map<string, { x: number; y: number; r: number }>();
  mids.forEach((c, i) => {
    const t = -Math.PI / 2 + (i * 2 * Math.PI) / mids.length;
    const d = mids.length === 1 ? 0 : g.spread;
    at.set(c.id, { x: cx + Math.cos(t) * d, y: cy + Math.sin(t) * d, r: g.midR });
  });
  shown.forEach((c, i) => {
    const t = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / shown.length;
    at.set(c.id, { x: cx + Math.cos(t) * g.rx, y: cy + Math.sin(t) * g.ry, r: g.outerR });
  });
  const edges: { a: EngineCard; b: EngineCard; mid: boolean }[] = [];
  for (const c of shown) for (const m of mids) if (linked(c, m)) edges.push({ a: c, b: m, mid: true });
  for (let i = 0; i < mids.length; i++) for (let j = i + 1; j < mids.length; j++) if (linked(mids[i]!, mids[j]!)) edges.push({ a: mids[i]!, b: mids[j]!, mid: true });
  const joined = new Set(edges.flatMap((e) => [e.a.id, e.b.id]));
  const dim = (e: { a: EngineCard; b: EngineCard }) => lit !== null && e.a.id !== lit && e.b.id !== lit;
  const node = (c: EngineCard, isMid: boolean, k: number) => {
    const p = at.get(c.id)!;
    const alone = !joined.has(c.id);
    // The top card of the middle names itself above, clear of the two below it.
    const above = isMid && mids.length > 1 && k === 0;
    const text = lines(c.name, g.chars);
    const off = lit !== null && lit !== c.id && !edges.some((e) => (e.a.id === lit && e.b.id === c.id) || (e.b.id === lit && e.a.id === c.id));
    return (
      <g key={c.id} role="button" tabIndex={0} aria-label={`Open ${c.name}`} data-testid={isMid ? "plan-map-middle" : "plan-map-card"} data-alone={alone || undefined}
        className="cursor-pointer" opacity={off ? 0.3 : 1}
        onClick={() => open(c.name)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(c.name); } }}
        onMouseEnter={() => setLit(c.id)} onMouseLeave={() => setLit(null)} onFocus={() => setLit(c.id)} onBlur={() => setLit(null)}>
        <clipPath id={`${clip}-${k}${isMid ? "m" : "r"}`}><circle cx={p.x} cy={p.y} r={p.r} /></clipPath>
        <circle cx={p.x} cy={p.y} r={p.r} fill="var(--surface-secondary)" />
        {c.art ? <image href={c.art} x={p.x - p.r} y={p.y - p.r} width={p.r * 2} height={p.r * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip}-${k}${isMid ? "m" : "r"})`} /> : null}
        <circle cx={p.x} cy={p.y} r={p.r} fill="none" strokeWidth={isMid ? 3 : 2}
          stroke={alone ? "var(--warning)" : isMid ? "var(--accent)" : "var(--foreground)"} strokeDasharray={alone ? "4 3" : undefined} />
        <text x={p.x} y={above ? p.y - p.r - 6 - (text.length - 1) * (g.font + 1) : p.y + p.r + g.font + 2} textAnchor="middle" fontSize={g.font} fontWeight={isMid ? 700 : 500}
          fill={alone ? "var(--warning)" : "var(--foreground)"} stroke="var(--background)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
          {text.map((t, i) => <tspan key={i} x={p.x} dy={i ? g.font + 1 : 0}>{t}</tspan>)}
        </text>
      </g>
    );
  };
  const hidden = ring.length - shown.length;
  return (
    <figure className="flex flex-col gap-1.5 m-0" data-testid="plan-map">
      <svg viewBox={`0 0 ${g.w} ${g.h}`} className="w-full h-auto" style={{ maxWidth: g.w }} role="group" aria-label="The plan's cards and how they link">
        {edges.map((e) => {
          const a = at.get(e.a.id)!, b = at.get(e.b.id)!;
          return <line key={`${e.a.id}|${e.b.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--accent)" strokeWidth={1.5} opacity={dim(e) ? 0.08 : lit ? 0.9 : 0.5} />;
        })}
        {shown.map((c, k) => node(c, false, k))}
        {mids.map((c, k) => node(c, true, k))}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--muted)">
        <span><Dot ring="var(--accent)" /> {middle.length && byName.get(middle[0]!)?.isCommander ? "your commander" : "finishes it"}</span>
        <span><span aria-hidden="true" className="inline-block align-middle w-4 border-t-2 border-(--accent) opacity-60" /> works with it</span>
        {[...shown, ...mids].some((c) => !joined.has(c.id)) ? <span><Dot ring="var(--warning)" dashed /> links to nothing here</span> : null}
        {hidden > 0 ? <span className="tabular-nums">+{hidden} more on this plan</span> : null}
      </figcaption>
    </figure>
  );
}

function Dot({ ring, dashed }: { ring: string; dashed?: boolean }) {
  return <span aria-hidden="true" className="inline-block align-middle size-2.5 rounded-full border-2" style={{ borderColor: ring, borderStyle: dashed ? "dashed" : "solid" }} />;
}
