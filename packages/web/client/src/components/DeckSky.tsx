import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { deckSky, type Sky, type Star } from "../lib/deck-sky.js";
import { displayName, type EngineModel } from "../lib/engine-model.js";
import { CardLinksContext } from "./card-menu.js";
import { useReducedMotion } from "./OrbitView.js";

/** THE DECK'S SKY, DRAWN (see `deck-sky.ts` for the layout). Every card is a star; each theme is a
 *  constellation in its colour with its name beside it; the commander is the bright disc in the
 *  middle; what no theme claims, and the lands, make the faint band at the edge.
 *
 *  ONE PICTURE, MANY READINGS. A chapter passes `lit`: its cards shine and are named, the rest of
 *  the sky dims, and `lit.lines` are drawn over it in gold. With nothing lit the sky shows the
 *  deck's shape; a theme's name lights that theme.
 *
 *  A TAP ON A STAR NAMES IT, and a second opens how it connects (the orbit over the report). The
 *  stars are not in the tab order -- a hundred stops would bury the page -- the theme names are. */
/** THE REPORT'S SKY, for a chapter drawn deep inside another component (the win plans sit in the
 *  build panel): the chapters provide the deck's engine model, and a panel that finds none draws
 *  no sky. */
export const SkyContext = createContext<EngineModel | null>(null);

export interface SkyLight {
  ids: ReadonlySet<string>;
  /** Lines to draw between lit cards, in gold: a route, a combo's loop, a swap. */
  lines?: readonly [string, string][];
  /** What the lit stars are, said under the sky ("The 12 cards this plan wins with"). */
  label?: string;
}

const R: Record<Star["kind"], number> = { commander: 26, hub: 6.5, member: 4, rest: 3, land: 2 };

export function DeckSky({ model, lit, caption, className = "" }: {
  model: EngineModel;
  lit?: SkyLight;
  /** The sentence under the sky when nothing is picked. */
  caption?: string;
  className?: string;
}) {
  const sky = useMemo(() => deckSky(model), [model]);
  const still = useReducedMotion();
  const links = useContext(CardLinksContext);
  const [theme, setTheme] = useState<number | null>(null);
  const [star, setStar] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  // What shines: a chapter's light, or the theme picked here, or everything.
  const picked = theme !== null ? new Set(sky.clusters[theme]!.ids) : null;
  const on = lit?.ids ?? picked;
  // The far end of a lit line is half lit: the card a thread runs to.
  const touched = new Set(lit?.lines?.flat() ?? []);
  const shines = (id: string) => !on || on.has(id) || sky.byId.get(id)?.kind === "commander";
  const named = new Set<string>([
    ...(lit && lit.ids.size <= 16 ? lit.ids : []),
    ...(star ? [star] : []), ...(hover ? [hover] : []),
  ]);
  const tapStar = (id: string) => {
    if (star === id && links?.idOf(sky.byId.get(id)!.name)) links.show(links.idOf(sky.byId.get(id)!.name)!);
    else setStar(id);
  };
  const picked1 = star ? sky.byId.get(star) : undefined;
  const cluster = picked1 && picked1.cluster >= 0 ? sky.clusters[picked1.cluster] : undefined;
  // NAMES KEEP A READABLE SIZE ON SCREEN, 11px however wide the sky is drawn: measured, since a
  // phone draws the same box in a third of the width. The box then widens to hold every name whole.
  const svgRef = useRef<SVGSVGElement>(null);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setShown(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const font = (sky.box.w / (shown || 480)) * 11;
  const charW = font * 0.76;
  const x = Math.min(sky.box.x, ...sky.clusters.map((c) => c.lx - (c.name.length * charW) / 2 - 12));
  const x1 = Math.max(sky.box.x + sky.box.w, ...sky.clusters.map((c) => c.lx + (c.name.length * charW) / 2 + 12));
  const y = sky.box.y - font, h = sky.box.h + 2 * font, w = x1 - x;
  // NO NAME OVER ANOTHER: a name that would overlap one already placed tries the constellation's
  // other side, then steps away from it until it is clear.
  const place = useMemo(() => {
    // The commander's disc is in the way too.
    const boxes: { x0: number; x1: number; y0: number; y1: number }[] = sky.stars.filter((s) => s.kind === "commander")
      .map((s) => ({ x0: s.x - R.commander - 6, x1: s.x + R.commander + 6, y0: s.y - R.commander - 6, y1: s.y + R.commander + 6 }));
    const hit = (b: typeof boxes[number]) => boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
    const ys = sky.clusters.map((c) => {
      const half = (c.name.length * charW) / 2;
      const at = (ly: number) => ({ x0: c.lx - half, x1: c.lx + half, y0: ly - font, y1: ly + font * 0.3 });
      const above = c.ly < c.y;
      const other = above ? c.y + c.r + font * 1.1 : c.y - c.r - font * 0.7;
      let ly = c.ly;
      if (hit(at(ly))) ly = other;
      for (let k = 1; k < 8 && hit(at(ly)); k++) ly += (ly < c.y ? -1 : 1) * font * 1.2;
      boxes.push(at(ly));
      return ly;
    });
    return { ys, boxes };
  }, [sky, font, charW]);
  // CARD NAMES TOO: the picked and pointed-at card first, then a chapter's lit cards, each above
  // its star, else below, else beside it; a lit name with no clear place is left to the tap.
  const nameAt = (() => {
    const taken = [...place.boxes];
    const hit = (b: typeof taken[number]) => taken.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
    const f = font * 0.95, cw = f * 0.58;
    const out = new Map<string, { x: number; y: number; anchor: "start" | "middle" | "end" }>();
    const order = [...named].sort((a, b) => Number(b === star || b === hover) - Number(a === star || a === hover));
    for (const id of order) {
      const s = sky.byId.get(id);
      if (!s || s.kind === "commander") continue;
      const text = s.name.split(" // ")[0]!, wd = text.length * cw, r = R[s.kind];
      const tries = [
        { x: s.x, y: s.y - r - f * 0.45, anchor: "middle" as const },
        { x: s.x, y: s.y + r + f * 1.05, anchor: "middle" as const },
        { x: s.x + r + 4, y: s.y + f * 0.35, anchor: "start" as const },
        { x: s.x - r - 4, y: s.y + f * 0.35, anchor: "end" as const },
      ];
      const box = (t: typeof tries[number]) => {
        const x0 = t.anchor === "middle" ? t.x - wd / 2 : t.anchor === "start" ? t.x : t.x - wd;
        return { x0, x1: x0 + wd, y0: t.y - f, y1: t.y + f * 0.25 };
      };
      const ok = tries.find((t) => !hit(box(t))) ?? (id === star || id === hover ? tries[0]! : null);
      if (!ok) continue;
      taken.push(box(ok));
      out.set(id, ok);
    }
    return out;
  })();
  const themes = sky.clusters.length;

  return (
    <figure className={`m-0 flex flex-col gap-2 ${className}`}>
      <svg ref={svgRef} viewBox={`${x} ${y} ${w} ${h}`} role="img" className="deck-sky block h-auto w-full select-none rounded-(--radius)"
        aria-label={`The deck as a sky: ${themes ? `${themes} theme${themes === 1 ? "" : "s"} (${sky.clusters.map((c) => c.name).join(", ")}) around the commander` : "the commander"}, and ${sky.stars.filter((s) => s.cluster < 0 && s.kind !== "commander").length} cards no theme claims at the edge.${lit?.label ? ` Lit: ${lit.label}.` : ""}`}
        onClick={() => { setStar(null); }}>
        <defs>
          <radialGradient id="sky-ground" cx="50%" cy="50%" r="65%">
            <stop offset="0%" stopColor="#1d1530" />
            <stop offset="100%" stopColor="#0b0810" />
          </radialGradient>
          <filter id="sky-glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="4" /></filter>
          <clipPath id="sky-disc" clipPathUnits="objectBoundingBox"><circle cx={0.5} cy={0.5} r={0.5} /></clipPath>
        </defs>
        <rect x={x} y={y} width={w} height={h} fill="url(#sky-ground)" />
        {/* The constellations' own lines, faint under a chapter's light. */}
        <g strokeLinecap="round">
          {sky.lines.map(([a, b], i) => {
            const A = sky.byId.get(a)!, B = sky.byId.get(b)!;
            const hue = B.hue.startsWith("var") ? A.hue : B.hue;
            const bright = shines(a) && shines(b);
            return <line key={i} pathLength={1} className={still ? undefined : "sky-line"} style={{ animationDelay: `${(i % 40) * 18}ms` }}
              x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={hue} strokeWidth={1.3} opacity={bright ? (lit ? 0.3 : 0.55) : 0.08} />;
          })}
        </g>
        {/* A chapter's own lines, in gold, over everything but the stars. */}
        {lit?.lines?.length ? (
          <g strokeLinecap="round" data-testid="sky-lit-lines">
            {lit.lines.map(([a, b], i) => {
              const A = sky.byId.get(a), B = sky.byId.get(b);
              return A && B ? <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="#D4A63A" strokeWidth={2.2} opacity={0.9} /> : null;
            })}
          </g>
        ) : null}
        <g>
          {sky.stars.map((s) => {
            const bright = shines(s.id);
            const r = R[s.kind];
            if (s.kind === "commander") {
              const art = model.cards.get(s.id)?.art;
              return (
                <g key={s.id} transform={`translate(${s.x} ${s.y})`} onClick={(e) => { e.stopPropagation(); tapStar(s.id); }} className="cursor-pointer">
                  <circle r={r + 14} fill="#f3eefc" opacity={0.18} filter="url(#sky-glow)" />
                  <circle r={r + 2} fill="#0b0810" stroke="#f3eefc" strokeWidth={2} />
                  {art ? <image href={art} x={-r} y={-r} width={2 * r} height={2 * r} clipPath="url(#sky-disc)" preserveAspectRatio="xMidYMid slice" /> : null}
                </g>
              );
            }
            return (
              <g key={s.id} data-star={s.id} transform={`translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})`} opacity={bright ? 1 : touched.has(s.id) ? 0.6 : 0.18}
                className="cursor-pointer" onClick={(e) => { e.stopPropagation(); tapStar(s.id); }}
                onPointerEnter={(e) => { if (e.pointerType === "mouse") setHover(s.id); }} onPointerLeave={() => setHover(null)}>
                {/* A generous invisible target: a 4px star is not something a thumb can hit. */}
                <circle r={11} fill="transparent" />
                {s.kind === "hub" ? <circle r={r * 2.4} fill={s.hue} opacity={0.35} filter="url(#sky-glow)" /> : null}
                <circle r={star === s.id || hover === s.id ? r * 1.6 : r} fill={s.kind === "land" || s.kind === "rest" ? s.hue : "#f3eefc"}
                  stroke={s.kind === "land" || s.kind === "rest" ? "none" : s.hue} strokeWidth={s.kind === "hub" ? 2.5 : 1.6}
                  className={still || s.kind !== "member" ? undefined : "sky-twinkle"} style={{ animationDelay: `${(s.x * 7 + s.y * 3) % 4000}ms` }}
                  opacity={s.kind === "land" ? 0.55 : s.kind === "rest" ? 0.7 : 1} />
              </g>
            );
          })}
        </g>
        {/* THE THEMES' NAMES, as a star chart names its constellations: each is a button. */}
        <g>
          {sky.clusters.map((c, i) => (
            <text key={c.tag} x={c.lx} y={place.ys[i]} textAnchor={c.anchor} role="button" tabIndex={0} aria-pressed={theme === i}
              // LIFTED TOWARD WHITE for the words: the darkest theme colours are drawn for a light
              // chip and read poorly as small letters on the night.
              className="sky-theme cursor-pointer" style={{ fill: `color-mix(in oklab, ${c.hue} 62%, #f3eefc)` }} fill={c.hue} fontSize={font} opacity={on && theme !== i && !c.ids.some((id) => on.has(id)) ? 0.35 : 1}
              onClick={(e) => { e.stopPropagation(); setStar(null); setTheme(theme === i ? null : i); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTheme(theme === i ? null : i); } }}>
              {c.name.toUpperCase()}
            </text>
          ))}
        </g>
        <g pointerEvents="none">
          {[...nameAt].map(([id, at]) => (
            <text key={id} x={at.x} y={at.y} textAnchor={at.anchor} className="sky-name" fontSize={font * 0.95}>{sky.byId.get(id)!.name.split(" // ")[0]}</text>
          ))}
        </g>
      </svg>
      <figcaption className="text-sm text-(--muted)" aria-live="polite">
        {picked1 ? (
          <>
            <b className="text-(--foreground)">{displayName(model.cards.get(picked1.id)!)}</b>
            {cluster ? <> · in <span style={{ color: cluster.hue }}>{cluster.name}</span></> : picked1.kind === "land" ? " · a land" : picked1.kind === "commander" ? " · your commander" : " · no theme claims it"}
            {links?.idOf(picked1.name) ? (
              <button type="button" className="ml-2 rounded-(--radius) border border-(--separator) px-2 py-0.5 text-xs text-(--foreground) hover:border-(--foreground)"
                onClick={() => links.show(links.idOf(picked1.name)!)}>See how it connects</button>
            ) : null}
          </>
        ) : theme !== null ? (
          <><span style={{ color: sky.clusters[theme]!.hue }}>{sky.clusters[theme]!.name}</span>: {sky.clusters[theme]!.ids.length} cards. Tap the name again for the whole sky.</>
        ) : lit?.label ?? caption ?? null}
      </figcaption>
    </figure>
  );
}

export type { Sky };
