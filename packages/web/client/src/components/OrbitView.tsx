import { useEffect, useMemo, useState } from "react";
import type { CardGraph, DeckReport } from "../types.js";
import { buildEngineModel, displayName, listNames, type EngineCard } from "../lib/engine-model.js";
import { buildOrbit, visiblePartners, type OrbitPartner, type OrbitSector } from "../lib/orbit-model.js";
import { Art, CardFace, Lines, ReadCards, RepeatKey, useNarrow } from "./engine-parts.js";

/** THE ONE-CARD VIEW AS AN ORBIT (graph evaluation 2026-09-25, design B; replaces `EgoView`).
 *
 *  A deterministic picture: the same card always draws the same way, with no simulation settling.
 *  The focus sits in the middle, the cards it works with around it in sectors by group, a solid line
 *  for a link that keeps working and a dashed one for a link that works once. The panel beside it
 *  says what the picture can't: the sentences, both cards' text, and the rest of the deck, as the
 *  cards one step further out and the ones that don't reach the focus at all.
 *
 *  A TAP READS, A SECOND TAP MOVES: the rule `EgoView` settled on, so a mis-aimed tap never throws
 *  the reader somewhere else. Where they have been is a trail above the picture. */
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
  if (!o) return null;

  const centre = (id: string) => {
    if (id === focusId) return;
    setTrail((t) => [...t.filter((x) => x !== id), focusId].slice(-6));
    onFocus(id);
  };
  const back = (i: number) => { const id = trail[i]!; setTrail(trail.slice(0, i)); onFocus(id); };
  const tap = (id: string) => {
    if (id === focusId) { setSel(null); setSector(null); return; }
    if (sel === id) centre(id);
    else { setSel(id); setSector(null); }
  };
  const focusName = displayName(o.focus);
  const selected = sel ? o.sectors.flatMap((s) => s.partners).find((p) => p.card.id === sel) : undefined;
  const openSector = sector !== null ? o.sectors.find((s) => (s.group?.tag ?? "") === sector) : undefined;

  return (
    <div className="flex flex-col gap-3 py-2">
      <nav aria-label="Cards you have centred" className="flex flex-wrap items-center gap-1 text-sm text-(--muted)">
        {onBack ? <button type="button" className="mr-2 min-h-11 rounded-(--radius) border border-(--separator) px-3" onClick={onBack}>Back to the card list</button> : null}
        {trail.map((id, i) => (
          <span key={id} className="flex items-center gap-1">
            <button type="button" className="min-h-11 underline decoration-dotted underline-offset-4 hover:text-(--foreground)" onClick={() => back(i)}>{short(m.cards.get(id)!, 24)}</button>
            <span aria-hidden="true">›</span>
          </span>
        ))}
        <b className="text-(--foreground)" aria-current="page">{focusName}</b>
      </nav>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <Orbit o={o} narrow={narrow} sel={sel} onTap={tap} onSector={(s) => { setSector(s.group?.tag ?? ""); setSel(null); }} />
        <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm lg:max-w-[440px]" aria-live="polite">
          {selected
            ? <PartnerPanel focus={o.focus} p={selected} onCentre={() => centre(selected.card.id)} onClose={() => setSel(null)} />
            : openSector
              ? <SectorPanel s={openSector} focusName={focusName} onPick={(id) => setSel(id)} onClose={() => setSector(null)} />
              : <Summary o={o} onSector={(s) => setSector(s.group?.tag ?? "")} onCentre={centre} />}
        </div>
      </div>
    </div>
  );
}

/** Before the comma, then cut to fit: "Inalla" for "Inalla, Archmage Ritualist". */
function short(c: EngineCard, max: number): string {
  const n = displayName(c).split(",")[0]!;
  return n.length > max ? `${n.slice(0, max - 1).trimEnd()}…` : n;
}

function Orbit({ o, narrow, sel, onTap, onSector }: {
  o: NonNullable<ReturnType<typeof buildOrbit>>; narrow: boolean; sel: string | null;
  onTap: (id: string) => void; onSector: (s: OrbitSector) => void;
}) {
  const L = layoutOrbit(o, narrow);
  const { W, H, cx, cy, R, r, fr, slots } = L;
  const clip = `orbit-clip-${narrow ? "n" : "w"}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${displayName(o.focus)} and the ${o.direct} cards it works with`}
      className="w-full shrink-0 select-none lg:w-[min(880px,62%)]" style={{ maxWidth: W }}>
      <defs><clipPath id={clip} clipPathUnits="objectBoundingBox"><circle cx={0.5} cy={0.5} r={0.5} /></clipPath></defs>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--separator)" />
      {slots.map((sl) => {
        if (sl.kind !== "card") return null;
        const lit = sel === sl.p.card.id;
        return <line key={`l-${sl.p.card.id}`} x1={cx} y1={cy} x2={sl.x} y2={sl.y} stroke={sl.s.hue}
          strokeWidth={lit ? 4 : sl.p.once ? 1.5 : 2.5} strokeDasharray={sl.p.once ? "5 5" : undefined} strokeOpacity={sel && !lit ? 0.25 : 0.9} />;
      })}
      {slots.map((sl) => {
        const { x, y } = sl;
        if (sl.kind === "more") {
          return (
            <g key={`m-${sl.s.name}`} transform={`translate(${x},${y})`} role="button" tabIndex={0} className={DISC}
              aria-label={`${sl.n} more: ${sl.s.name}`} onClick={() => onSector(sl.s)} onKeyDown={key(() => onSector(sl.s))}>
              <circle r={r} fill="var(--surface-secondary)" stroke={sl.s.hue} strokeWidth={2} />
              <text textAnchor="middle" dy={5} fontSize={narrow ? 12 : 14} fill="var(--foreground)">+{sl.n}</text>
            </g>
          );
        }
        const { card } = sl.p;
        const lit = sel === card.id;
        return (
          <g key={card.id} transform={`translate(${x},${y})`} role="button" tabIndex={0} className={DISC}
            aria-label={`${displayName(card)}${card.isToken ? " (token)" : ""}`} aria-pressed={lit}
            opacity={sel && !lit ? 0.45 : 1} onClick={() => onTap(card.id)} onKeyDown={key(() => onTap(card.id))}>
            <circle r={r + 2} fill="var(--background)" stroke={sl.s.hue} strokeWidth={lit ? 4 : 2} strokeDasharray={card.isToken ? "3 3" : undefined} />
            {card.art ? <image href={card.art} x={-r} y={-r} width={2 * r} height={2 * r} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" /> : null}
            <text x={sl.lx} y={sl.ly} dy={4} textAnchor={sl.anchor} fontSize={narrow ? 13 : 12} fill="var(--foreground)" paintOrder="stroke" stroke="var(--background)" strokeWidth={4} strokeLinejoin="round">
              {sl.label}
            </text>
          </g>
        );
      })}
      <g transform={`translate(${cx},${cy})`} role="button" tabIndex={0} className={DISC} aria-label={`${displayName(o.focus)}, in the middle`}
        onClick={() => onTap(o.focus.id)} onKeyDown={key(() => onTap(o.focus.id))}>
        <circle r={fr + 3} fill="var(--background)" stroke="var(--foreground)" strokeWidth={3} />
        {o.focus.art ? <image href={o.focus.art} x={-fr} y={-fr} width={2 * fr} height={2 * fr} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" /> : null}
        <text y={fr + 20} textAnchor="middle" fontSize={narrow ? 13 : 15} fontWeight={600} fill="var(--foreground)" paintOrder="stroke" stroke="var(--background)" strokeWidth={5} strokeLinejoin="round">
          {short(o.focus, narrow ? 16 : 24)}
        </text>
      </g>
    </svg>
  );
}

/** No browser outline on a disc: SVG draws it as a box around the name. A keyboard focus
 *  thickens the disc's own ring instead. */
const DISC = "group cursor-pointer outline-none [&>circle]:group-focus-visible:stroke-(--accent) [&>circle]:group-focus-visible:[stroke-width:5]";

type Slot = { x: number; y: number; a: number } & (
  | { kind: "card"; p: OrbitPartner; s: OrbitSector; label: string; lx: number; ly: number; anchor: "start" | "middle" | "end" }
  | { kind: "more"; n: number; s: OrbitSector }
);

/** WHERE EVERYTHING GOES, the same every time for the same card. The ring holds as many discs as
 *  fit with a gap between them; the rest are counted on each sector's "+N". Names go outside
 *  their disc, and a name that would overlap one already placed moves a line further out. */
export function layoutOrbit(o: NonNullable<ReturnType<typeof buildOrbit>>, narrow: boolean) {
  // One geometry per width rather than one scaled down: at 390px a 720 box drew 6px names.
  const W = narrow ? 440 : 880, H = narrow ? 430 : 720;
  const cx = W / 2, cy = H / 2;
  const R = narrow ? 128 : 228, r = narrow ? 17 : 25, fr = narrow ? 36 : 58;
  const labelMax = narrow ? 10 : 17, charW = narrow ? 7.2 : 6.6, lineH = narrow ? 15 : 14;
  const room = Math.floor((2 * Math.PI * R) / (2 * r + 10));
  const gaps = o.sectors.length > 1 ? o.sectors.length : 0;
  let cap = room - gaps;
  let vis = visiblePartners(o, cap);
  for (let used = count(vis, gaps); used > room && cap > 1; used = count(vis, gaps)) vis = visiblePartners(o, --cap);
  type Raw = { kind: "gap" } | { kind: "card"; p: OrbitPartner; s: OrbitSector } | { kind: "more"; n: number; s: OrbitSector };
  const raw: Raw[] = [];
  for (const v of vis) {
    if (raw.length && gaps) raw.push({ kind: "gap" });
    for (const p of v.shown) raw.push({ kind: "card", p, s: v.sector });
    if (v.hidden) raw.push({ kind: "more", n: v.hidden, s: v.sector });
  }
  if (gaps) raw.push({ kind: "gap" });
  const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const hit = (b: (typeof boxes)[number]) => boxes.some((o2) => b.x0 < o2.x1 && b.x1 > o2.x0 && b.y0 < o2.y1 && b.y1 > o2.y0);
  const slots: Slot[] = [];
  raw.forEach((sl, i) => {
    if (sl.kind === "gap") return;
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, raw.length);
    const ca = Math.cos(a), sa = Math.sin(a);
    const x = cx + R * ca, y = cy + R * sa;
    if (sl.kind === "more") { slots.push({ ...sl, x, y, a }); return; }
    const label = `${short(sl.p.card, labelMax)}${sl.p.card.isToken ? " (token)" : ""}`;
    const w = label.length * charW;
    // Near the top and bottom a name sits above or below its disc; at the sides, beside it.
    const vertical = Math.abs(ca) <= 0.5;
    const anchor = vertical ? "middle" : ca > 0 ? "start" : "end";
    let lx = vertical ? 0 : (r + 6) * ca, ly = vertical ? (sa > 0 ? r + 18 : -(r + 8)) : (r + 6) * sa;
    const box = () => {
      const ax = x + lx, ay = y + ly;
      const x0 = anchor === "start" ? ax : anchor === "end" ? ax - w : ax - w / 2;
      return { x0, x1: x0 + w, y0: ay - lineH + 4, y1: ay + 4 };
    };
    for (let k = 0; k < 4 && hit(box()); k++) {
      if (vertical) ly += Math.sign(sa) * lineH; else { lx += ca * 10; ly += sa * lineH; }
    }
    boxes.push(box());
    slots.push({ ...sl, x, y, a, label, lx, ly, anchor });
  });
  return { W, H, cx, cy, R, r, fr, slots };
}

function count(vis: ReturnType<typeof visiblePartners>, gaps: number): number {
  return gaps + vis.reduce((t, v) => t + v.shown.length + (v.hidden ? 1 : 0), 0);
}

const key = (f: () => void) => (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); f(); } };

function Summary({ o, onSector, onCentre }: {
  o: NonNullable<ReturnType<typeof buildOrbit>>; onSector: (s: OrbitSector) => void; onCentre: (id: string) => void;
}) {
  const name = displayName(o.focus);
  return (
    <>
      <div className="flex items-start gap-3">
        <CardFace card={o.focus} className="w-24" />
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-base">{name}</h3>
          <p className="text-(--muted)">
            {o.direct === 0
              ? "Nothing else in the deck works with this card."
              : <>Works with <b className="text-(--foreground)">{o.direct} card{o.direct === 1 ? "" : "s"}</b>. Tap one to read how; tap it again to put it in the middle.</>}
          </p>
        </div>
      </div>
      {o.sectors.length ? (
        <ul className="flex flex-col gap-1">
          {o.sectors.map((s) => {
            const once = s.partners.filter((p) => p.once).length;
            return (
              <li key={s.name}>
                <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-(--radius) px-1 text-left hover:bg-(--surface-secondary)" onClick={() => onSector(s)}>
                  <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.hue }} />
                  <span className="flex-1">{s.name}</span>
                  <span className="text-(--muted) whitespace-nowrap">{s.partners.length}{once ? `, ${once} only once` : ""}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="text-xs text-(--muted)">A solid line keeps working; a dashed line works only once. A dashed ring is a token.</p>
      <ReadCards cards={[o.focus]} />
      {o.near.length ? (
        <details>
          <summary className="cursor-pointer py-1.5">
            <b>{o.near.length} more card{o.near.length === 1 ? "" : "s"}</b> work with one of these, but not with {short(o.focus, 24)} itself
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {o.near.map(({ card, via }) => (
              <li key={card.id}>
                <button type="button" className="min-h-9 text-left hover:underline" onClick={() => onCentre(card.id)}>
                  <b>{displayName(card)}</b> <span className="text-(--muted)">through {listNames(via.map(displayName), 3)}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {o.far.length ? (
        <details>
          <summary className="cursor-pointer py-1.5">
            <b>{o.far.length} card{o.far.length === 1 ? "" : "s"}</b> don't connect to {short(o.focus, 24)}, even through another card
          </summary>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {o.far.map((card) => (
              <li key={card.id}><button type="button" className="min-h-9 text-left hover:underline" onClick={() => onCentre(card.id)}>{displayName(card)}</button></li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

function SectorPanel({ s, focusName, onPick, onClose }: { s: OrbitSector; focusName: string; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.hue }} />
        <h3 className="flex-1 font-semibold text-base">{s.name}</h3>
        <button type="button" className="min-h-11 rounded-(--radius) border border-(--separator) px-3" onClick={onClose}>Back</button>
      </div>
      <p className="text-(--muted)">The {s.partners.length} card{s.partners.length === 1 ? "" : "s"} here that work with {focusName}. Tap one to read how.</p>
      <ul className="flex flex-col gap-1">
        {s.partners.map((p) => (
          <li key={p.card.id}>
            <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-(--radius) px-1 text-left hover:bg-(--surface-secondary)" onClick={() => onPick(p.card.id)}>
              <Art card={p.card} size={32} />
              <span className="flex-1">{displayName(p.card)}{p.card.isToken ? <span className="text-(--muted)"> (token)</span> : null}</span>
              {p.once ? <span className="text-xs text-(--muted)">only once</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
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
      <button type="button" className="min-h-11 self-start rounded-(--radius) border border-(--accent) px-4 text-(--accent)" onClick={onCentre}>Put {short(p.card, 24)} in the middle</button>
    </>
  );
}
