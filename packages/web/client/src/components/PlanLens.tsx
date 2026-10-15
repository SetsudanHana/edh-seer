import { useEffect, useMemo, useState } from "react";
import { WIN_PHRASE } from "@edh-seer/matcher/deck-sentence";
import type { CardGraph, DeckReport } from "../types.js";
import type { EngineCard, EngineModel } from "../lib/engine-model.js";
import { acrossPlans, counts, cutPreview, partnersOf, planLens, type Partner, type PlanLens as Lens } from "../lib/plan-lens.js";
import { CardName } from "./card-drawer.js";
import { Art } from "./engine-parts.js";

/** ONE WIN PLAN ON A MAP (persona rounds 2026-10-14..15). The plan's cards on the inner ring, the
 *  cards that set them up outside, a line for every card feeding another: solid when it keeps
 *  working, dashed when it works once, gold for a combo. Beside it, the same facts as a list the
 *  reader can check sentence by sentence.
 *
 *  Five rounds built it. Against the shipped report the map with mana value and colours took the
 *  hard tasks from 3.3 of 6 to 5.5; a plain table of the same facts scored 6.0, because it showed
 *  every link at once and each link's sentence. This keeps the map and takes the table's two
 *  strengths: every partner listed on its card, and the sentence behind each one a tap away. With
 *  them the lens matched the table (8 of 8 on every seat) and its readers were surer of their
 *  answers (confidence 5.0 against 3.25 on "what does cutting Displacer Kitten cost"). */

const GOLD = "#D4A63A";
const MANA: Record<string, string> = { W: "var(--mana-w)", U: "var(--mana-u)", B: "var(--mana-b)", R: "var(--mana-r)", G: "var(--mana-g)" };
const COLOUR: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const TURNS = [2, 3, 4, 5, 6];
const PHONE_SETUP = 6;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const front = (n: string) => n.split(" // ")[0]!;
const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** A phone draws a taller map with fewer set-up cards: 390px cannot hold ten names on a ring. Every
 *  count still reads the whole lens, so a card is "fed by" the same number on a phone and a desk. */
function useWide() {
  const q = "(min-width: 48rem)";
  const [wide, setWide] = useState(() => typeof window === "undefined" || !window.matchMedia || window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export function PlanLens({ report, graph, model, plan: planClass, planCards, plans, manaValueOf }: {
  report: DeckReport; graph: CardGraph; model: EngineModel;
  /** The plan picked above, and its cards. */
  plan: string; planCards: readonly string[];
  /** Every win plan, for what a tapped card feeds in each and "across your win plans". */
  plans: readonly { plan: string; cards: readonly string[] }[];
  manaValueOf: (name: string) => number | undefined;
}) {
  const wide = useWide();
  const lens = useMemo(() => planLens(model, planCards, (report.combos ?? []).map((c) => c.cards)), [model, planCards, report.combos]);
  const perPlan = useMemo(() => plans.map((p) => ({
    phrase: WIN_PHRASE[p.plan] ?? p.plan, here: p.plan === planClass,
    lens: p.plan === planClass ? lens : planLens(model, p.cards, (report.combos ?? []).map((c) => c.cards)),
  })), [plans, planClass, lens, model, report.combos]);
  const allPlanCards = useMemo(() => [...new Set(plans.flatMap((p) => p.cards))], [plans]);
  const drawn = useMemo(() => (wide ? lens.setup : lens.setup.slice(0, PHONE_SETUP)), [lens, wide]);
  const [tap, setTap] = useState<string | null>(null);
  const [cut, setCut] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [lastingOnly, setLastingOnly] = useState(false);
  const [turn, setTurn] = useState<number | null>(null);
  const [colour, setColour] = useState<string | null>(null);
  // A new plan is a new map: what was tapped, cut or filtered on the old one may not be on this one
  // (a colour the new plan does not play would fade every card, with no chip left to clear it).
  useEffect(() => { setTap(null); setCut(null); setOpen(null); setColour(null); setTurn(null); }, [planClass]);

  const card = useMemo(() => {
    const m = new Map<string, EngineCard>();
    for (const c of model.cards.values()) if (!m.has(c.physical) || (m.get(c.physical)!.isFace && !c.isFace)) m.set(c.physical, c);
    return m;
  }, [model]);
  const colours = useMemo(() => {
    const m = new Map<string, string[]>();
    // Every face's colours: Fire // Ice is red AND blue.
    for (const n of graph.nodes) {
      const k = (n as { cardName?: string }).cardName ?? n.id;
      m.set(k, [...new Set([...(m.get(k) ?? []), ...(n.colors ?? []).filter((c) => c in MANA)])].sort((a, b) => "WUBRG".indexOf(a) - "WUBRG".indexOf(b)));
    }
    return m;
  }, [graph]);
  if (!lens.plan.length) return null;

  const cutSet = new Set(cut ? [cut] : []);
  const turnMana = turn === null ? null : Math.floor(report.manaAvailability?.rows.find((r) => r.turn === turn)?.mana.median ?? turn);
  const passes = (n: string) => {
    const mv = manaValueOf(n) ?? manaValueOf(front(n));
    if (turnMana !== null && mv !== undefined && mv > turnMana) return false;
    if (colour && !(colours.get(n) ?? []).includes(colour)) return false;
    return true;
  };
  const deckColours = ["W", "U", "B", "R", "G"].filter((k) => [...lens.plan, ...lens.setup].some((n) => (colours.get(n) ?? []).includes(k)));
  const hasCombo = lens.links.some((l) => l.combo);
  const phrase = cap(WIN_PHRASE[planClass] ?? planClass);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="plan-lens" data-testid="plan-lens">
      <h3 id="plan-lens" className="eyebrow text-(--foreground)">{phrase}, on the map</h3>
      <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="plan-lens-filters">
        <span className="text-(--muted)">Castable by turn</span>
        {TURNS.map((t) => <Chip key={t} on={turn === t} onClick={() => setTurn(turn === t ? null : t)}>{t}</Chip>)}
        <Chip on={turn === null} onClick={() => setTurn(null)}>Any</Chip>
        {deckColours.length > 1 || colour ? <>
          <span className="ml-2 text-(--muted)">Colour</span>
          {deckColours.map((k) => <Chip key={k} on={colour === k} onClick={() => setColour(colour === k ? null : k)}><Dot k={k} />{COLOUR[k]}</Chip>)}
          <Chip on={colour === null} onClick={() => setColour(null)}>All</Chip>
        </> : null}
        <span className="ml-2" />
        <Chip on={lastingOnly} onClick={() => setLastingOnly(!lastingOnly)}>Lasting links only</Chip>
        {cut ? <Chip on onClick={() => setCut(null)}>Cut: {front(cut)} ✕</Chip> : null}
      </div>
      {turnMana !== null ? <p className="text-xs text-(--muted)">Turn {turn}: {turnMana} mana in a typical game. Cards that cost more are faded.</p> : null}
      <div className="grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex flex-col gap-2">
          <LensMap lens={lens} setup={drawn} wide={wide} card={card} colours={colours} manaValueOf={manaValueOf} tap={tap} cut={cutSet} lastingOnly={lastingOnly} passes={passes}
            onTap={(n) => { setTap(tap === n ? null : n); setOpen(null); }} />
          <p className="text-xs text-(--muted) max-w-[75ch]" data-testid="plan-lens-key">
            Inner ring: the cards in this plan. Outer ring: the cards that set them up. A line runs from a card to a plan card it feeds:
            solid keeps working, dashed works once, thicker works better together.{hasCombo ? " Gold is a combo: the two loop." : ""} The
            number on a card is its mana value; the dots above it are its colours. Under each card: how many cards feed it (or it
            feeds), and how many of those links keep working. Tap a card to read it.
            {drawn.length < lens.setup.length ? ` The map draws the ${drawn.length} strongest cards that set it up; all ${lens.setup.length} are in the list.` : ""}
          </p>
        </div>
        <Panel lens={lens} phrase={phrase} card={card} colours={colours} manaValueOf={manaValueOf} model={model} allPlanCards={allPlanCards} perPlan={perPlan}
          tap={tap} cut={cut} cutSet={cutSet} open={open} lastingOnly={lastingOnly} hasCombo={hasCombo}
          onCut={(n) => { setCut(n); setTap(null); }} onOpen={(n) => setOpen(open === n ? null : n)} onClose={() => setTap(null)} />
      </div>
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 ${on ? "border-(--accent) bg-(--surface-secondary) text-(--foreground)" : "border-(--field-border) text-(--muted) hover:text-(--foreground)"}`}>
      {children}
    </button>
  );
}

const Dot = ({ k }: { k: string }) => <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: MANA[k] }} />;

function LensMap({ lens, setup, wide, card, colours, manaValueOf, tap, cut, lastingOnly, passes, onTap }: {
  lens: Lens; setup: string[]; wide: boolean; card: Map<string, EngineCard>; colours: Map<string, string[]>; manaValueOf: (n: string) => number | undefined;
  tap: string | null; cut: ReadonlySet<string>; lastingOnly: boolean; passes: (n: string) => boolean; onTap: (n: string) => void;
}) {
  const W = wide ? 900 : 460, H = wide ? 640 : 780;
  const pos = useMemo(() => layout(lens, setup, wide), [lens, setup, wide]);
  const inPlan = new Set(lens.plan);
  const max = Math.max(0.01, ...lens.links.map((l) => l.strength));
  const near = tap ? new Set(lens.links.filter((l) => l.from === tap || l.to === tap).flatMap((l) => [l.from, l.to])) : null;
  // One line per pair of cards: a plan card both feeding and fed by another is drawn once, solid if
  // either way keeps working.
  const lines = new Map<string, { a: string; b: string; lasting: boolean; combo: boolean; strength: number; hue?: string }>();
  for (const l of lens.links) {
    if (!pos.has(l.from) || !pos.has(l.to)) continue;
    const k = [l.from, l.to].sort().join("\u0001");
    const e = lines.get(k);
    if (!e) lines.set(k, { a: l.from, b: l.to, lasting: l.lasting, combo: l.combo, strength: l.strength, hue: l.hue });
    else lines.set(k, { ...e, lasting: e.lasting || l.lasting, combo: e.combo || l.combo, strength: Math.max(e.strength, l.strength), hue: e.hue ?? l.hue });
  }
  const drawn = [...lines.values()].filter((e) => !cut.has(e.a) && !cut.has(e.b) && !(lastingOnly && !e.lasting && !e.combo))
    // Lasting lines on top of the dashed ones.
    .sort((x, y) => Number(x.lasting || x.combo) - Number(y.lasting || y.combo));
  // EVERY LABEL WHERE IT FITS (round 6, phone: Nightmare Shepherd's name ran into Wicked Visitor's, and
  // The Rani's count was cut at the edge because the edge check measured the name, not the longer
  // count under it). Plan cards are placed first; a set-up card's label goes under its disc, or above
  // it when under would overlap a label or a disc already placed.
  const labels = new Map<string, { label: string; count: string; alone: boolean; lx: number; ly: number }>();
  const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [...pos].map(([n, [x, y]]) => { const r = radius(inPlan.has(n), wide); return { x0: x - r, x1: x + r, y0: y - r, y1: y + r }; });
  const hits = (b: { x0: number; x1: number; y0: number; y1: number }) => boxes.reduce((t, o) => t + Math.max(0, Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0)) * Math.max(0, Math.min(b.y1, o.y1) - Math.max(b.y0, o.y0)), 0);
  for (const n of [...lens.plan, ...setup]) {
    const p = pos.get(n);
    if (!p) continue;
    const [x, y] = p, win = inPlan.has(n), r = radius(win, wide);
    const k = counts(partnersOf(lens, n, cut)), before = counts(partnersOf(lens, n));
    const alone = win && before.lasting > 0 && k.lasting === 0;
    const label = front(card.get(n)?.name ?? n);
    const count = cut.has(n) ? "cut" : alone ? "no lasting link left" : lastingOnly ? `${k.lasting} lasting` : `${win ? "fed by" : "feeds"} ${k.all} · ${k.lasting} lasting`;
    const half = Math.max(label.length * NAME_PX(wide) * 0.29, count.length * COUNT_PX(wide) * 0.28) + 4;
    const lx = Math.max(half, Math.min(W - half, x));
    // Under the disc: name baseline r+15 below its centre, count 14 under that. Above: clear of the
    // colour dots and the mana-value badge.
    const at = (ly: number) => ({ ly, box: { x0: lx - half, x1: lx + half, y0: ly - NAME_PX(wide), y1: ly + 17 } });
    const under = at(y + r + 15), over = at(y - r - 34);
    const pick = win || hits(under.box) <= hits(over.box) ? under : over;
    boxes.push(pick.box);
    labels.set(n, { label, count, alone, lx, ly: pick.ly });
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-(--radius) border border-(--separator) bg-(--surface)" role="group" aria-label="The plan's cards and the cards that set them up" data-testid="plan-lens-map">
      <defs>
        {[...pos.keys()].map((n, i) => <clipPath key={n} id={`lens-clip-${i}`}><circle cx={pos.get(n)![0]} cy={pos.get(n)![1]} r={radius(inPlan.has(n), wide)} /></clipPath>)}
      </defs>
      <g pointerEvents="none">
        {drawn.map((e) => {
          const [x1, y1] = pos.get(e.a)!, [x2, y2] = pos.get(e.b)!;
          const on = !tap || e.a === tap || e.b === tap;
          const dim = !passes(e.a) || !passes(e.b);
          return <line key={`${e.a}|${e.b}`} x1={x1} y1={y1} x2={x2} y2={y2} data-testid="plan-lens-line" data-lasting={e.lasting ? "" : undefined}
            stroke={e.combo ? GOLD : e.hue ?? "var(--edge)"} strokeWidth={e.combo ? 3.4 : 1.2 + 1.4 * e.strength / max + (tap && on ? 1 : 0)}
            strokeDasharray={e.lasting || e.combo ? undefined : "6 6"} strokeLinecap="round"
            opacity={(on ? 0.85 : 0.12) * (dim ? 0.25 : 1) * (e.lasting || e.combo ? 1 : 0.4)} />;
        })}
      </g>
      {[...pos.keys()].map((n, i) => {
        const c = card.get(n), [x, y] = pos.get(n)!, win = inPlan.has(n), r = radius(win, wide);
        const lit = (!near || near.has(n)) && passes(n);
        const isCut = cut.has(n);
        const { label, count, alone, lx, ly } = labels.get(n)!;
        const mv = manaValueOf(n) ?? manaValueOf(front(n));
        const cs = colours.get(n) ?? [];
        return (
          <g key={n} role="button" tabIndex={0} aria-pressed={tap === n} aria-label={`${label}${win ? ", in this plan" : ", sets it up"}`}
            onClick={() => onTap(n)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onTap(n); } }}
            className="group cursor-pointer outline-none" opacity={isCut ? 0.3 : lit ? 1 : 0.25} data-testid="plan-lens-card" data-card={n}>
            {c?.art ? <image href={c.art} x={x - r} y={y - r} width={2 * r} height={2 * r} preserveAspectRatio="xMidYMid slice" clipPath={`url(#lens-clip-${i})`} />
              : <circle cx={x} cy={y} r={r} fill="var(--surface-tertiary)" />}
            <circle cx={x} cy={y} r={r} fill="none" stroke={tap === n ? "var(--accent)" : win ? "var(--foreground)" : "var(--edge)"} strokeWidth={tap === n ? 3.5 : win ? 2.5 : 1.5} />
            {alone ? <circle cx={x} cy={y} r={r + 5} fill="none" stroke="var(--danger)" strokeWidth={3} /> : null}
            {/* Keyboard focus is a ring round the disc, not the browser's box round the whole group. */}
            <circle cx={x} cy={y} r={r + 9} fill="none" strokeWidth={2.5} className="stroke-transparent group-focus-visible:stroke-(--accent)" />
            {mv !== undefined ? <g>
              <circle cx={x + r * 0.78} cy={y - r * 0.78} r={10} fill="var(--background)" stroke="var(--foreground)" strokeWidth={1.2} />
              <text x={x + r * 0.78} y={y - r * 0.78 + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--foreground)">{mv}</text>
            </g> : null}
            {cs.map((k2, j) => <circle key={k2} cx={x - (cs.length - 1) * 6 + j * 12} cy={y - r - 7} r={5} fill={MANA[k2]} stroke="var(--background)" strokeWidth={1.5} />)}
            {isCut ? <text x={x} y={y + 9} textAnchor="middle" fontSize={26} fontWeight={700} fill="var(--danger)">✕</text> : null}
            {/* A label never takes the tap: on a phone a plan card's label lies over the disc beside it. */}
            <text pointerEvents="none" x={lx} y={ly} textAnchor="middle" fontSize={NAME_PX(wide)} fontWeight={win ? 600 : 400} fill="var(--foreground)">{label}</text>
            <text pointerEvents="none" x={lx} y={ly + 14} textAnchor="middle" fontSize={COUNT_PX(wide)} fill={alone ? "var(--danger)" : "var(--muted)"} data-testid="plan-lens-count">{count}</text>
          </g>
        );
      })}
    </svg>
  );
}

const radius = (win: boolean, wide: boolean) => (wide ? (win ? 30 : 23) : (win ? 22 : 17));
const NAME_PX = (wide: boolean) => (wide ? 12 : 13);
const COUNT_PX = (wide: boolean) => (wide ? 10.5 : 11.5);

/** Plan cards evenly on the inner ring; each set-up card beside the plan cards it feeds, pushed apart
 *  so no two share a slot. */
function layout(lens: Lens, setup: string[], wide: boolean) {
  const n = lens.plan.length;
  const cx = wide ? 450 : 230, cy = wide ? 320 : 390;
  const R1 = wide ? [165, 135] : [Math.min(120, 60 + n * 8), Math.min(175, 80 + n * 12)];
  const R2 = wide ? [345, 240] : [190, 330];
  const pos = new Map<string, [number, number, number]>();
  lens.plan.forEach((p, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; pos.set(p, [cx + Math.cos(a) * R1[0]!, cy + Math.sin(a) * R1[1]!, a]); });
  const fa = setup.map((s) => {
    const to = lens.links.filter((l) => l.from === s).map((l) => pos.get(l.to)).filter((p): p is [number, number, number] => !!p);
    return { s, a: Math.atan2(to.reduce((t, p) => t + Math.sin(p[2]), 0), to.reduce((t, p) => t + Math.cos(p[2]), 0)) };
  }).sort((x, y) => x.a - y.a);
  const gap = (2 * Math.PI / Math.max(fa.length, 1)) * 0.8;
  for (let k = 0; k < 40; k++) for (let i = 0; i < fa.length; i++) {
    const j = (i + 1) % fa.length;
    let d = fa[j]!.a - fa[i]!.a;
    if (j === 0) d += 2 * Math.PI;
    if (d < gap) { fa[i]!.a -= (gap - d) / 2; fa[j]!.a += (gap - d) / 2; }
  }
  for (const { s, a } of fa) pos.set(s, [cx + Math.cos(a) * R2[0]!, cy + Math.sin(a) * R2[1]!, a]);
  return new Map([...pos].map(([k, [x, y]]) => [k, [x, y] as [number, number]]));
}

function Panel({ lens, phrase, card, colours, manaValueOf, model, allPlanCards, perPlan, tap, cut, cutSet, open, lastingOnly, hasCombo, onCut, onOpen, onClose }: {
  lens: Lens; phrase: string; card: Map<string, EngineCard>; colours: Map<string, string[]>; manaValueOf: (n: string) => number | undefined;
  model: EngineModel; allPlanCards: readonly string[]; perPlan: { phrase: string; here: boolean; lens: Lens }[];
  tap: string | null; cut: string | null; cutSet: ReadonlySet<string>; open: string | null; lastingOnly: boolean; hasCombo: boolean;
  onCut: (n: string) => void; onOpen: (n: string) => void; onClose: () => void;
}) {
  const inPlan = new Set(lens.plan);
  const meta = (n: string) => {
    const mv = manaValueOf(n) ?? manaValueOf(front(n));
    const cs = (colours.get(n) ?? []).map((k) => COLOUR[k]).join(", ") || "Colourless";
    return `${mv !== undefined ? `${mv} mana · ` : ""}${cs}`;
  };
  const box = "flex flex-col gap-2 rounded-(--radius) border border-(--separator) bg-(--surface) p-4 text-sm";

  // WHAT A CUT COSTS (round 4: three seats of four read "None is left without a lasting link (…
  // had none to begin with)" as a contradiction). The cut's losses, whether each keeps another, and
  // the cards that never had a lasting link, said apart.
  if (cut) {
    const p = cutPreview(lens, cutSet);
    const names = (xs: string[]) => and(xs.map(front));
    const loopy = p.never.some((n) => partnersOf(lens, n).some((x) => x.combo));
    return (
      <div className={box} data-testid="plan-lens-panel">
        <h4 className="text-base font-semibold">What if you cut {front(cut)}?</h4>
        <p className="text-xs text-(--muted)">{phrase}: what each card in the plan keeps, in links that keep working.</p>
        <p data-testid="plan-lens-cut-summary">
          {p.lose.length ? <>{names(p.lose)} {p.lose.length > 1 ? "lose" : "loses"} a lasting link. </> : "No card in the plan loses a lasting link. "}
          {p.left.length ? <b className="text-(--danger)">{names(p.left)} would have no lasting link left. </b>
            : p.lose.length ? (p.lose.length > 1 ? "Each still has another. " : "It still has others. ") : null}
          {p.never.length ? <>{names(p.never)} {p.never.length > 1 ? "have" : "has"} no lasting link with or without {front(cut)}: every link {p.never.length > 1 ? "they make" : "it makes"} works once{loopy ? " (or is part of a combo loop)" : ""}.</> : null}
        </p>
        <ul className="flex flex-col gap-2">
          {p.rows.map((r) => (
            <li key={r.name} className="flex gap-2">
              {card.get(r.name) ? <Art card={card.get(r.name)!} size={28} /> : null}
              <div className="flex flex-col gap-1">
                <span><b><CardName name={r.name} /></b></span>
                <span className="text-xs text-(--muted)">lasting links: {r.before} → {r.after}{r.after === 0 && r.before > 0 ? " · none left" : ""}</span>
                <Chips ps={partnersOf(lens, r.name, cutSet)} lastingOnly={lastingOnly} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (tap) {
    const c = card.get(tap);
    const x = acrossPlans(model, tap, allPlanCards);
    const mine = partnersOf(lens, tap);
    const k = counts(mine);
    const win = inPlan.has(tap);
    return (
      <div className={box} data-testid="plan-lens-panel">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-base font-semibold"><CardName name={tap} /></h4>
          <button type="button" onClick={onClose} className="min-h-8 px-2 text-xs text-(--muted) hover:text-(--foreground)" aria-label="Back to the plan">✕</button>
        </div>
        <p className="text-xs text-(--muted)">{c?.typeLine}{c?.manaCost ? ` · ${c.manaCost}` : ""} · {meta(tap)} · {win ? "in this plan" : "sets this plan up"}</p>
        {c?.text ? <p className="whitespace-pre-line rounded-(--radius) border border-(--separator) p-2 text-xs">{c.text}</p> : null}
        {/* EACH COUNT SAYS WHAT IT COUNTS (rounds 4 and 6). "Works with 11 of your 12 plan cards" beside
          *  "feeds 4 · 3 lasting" read as a contradiction to four seats of five: the map counts what the
          *  card feeds in one plan, the 11 counts links either way across every plan. The per-plan
          *  feeds come first, each plan named; the either-way count follows and says it is one. */}
        <p data-testid="plan-lens-across">
          {win
            ? <>In this plan {k.all} {k.all === 1 ? "card feeds" : "cards feed"} it, {k.lasting} of them with links that keep working. </>
            : (() => {
              const fed = perPlan.map((p) => ({ ...p, k: counts(partnersOf(p.lens, tap)) })).filter((p) => p.k.all);
              return fed.length ? <>It feeds {and(fed.map((p) => `${p.k.all} ${p.k.all === 1 ? "card" : "cards"} in ${p.here ? "this plan" : `“${cap(p.phrase)}”`} (${p.k.lasting} lasting)`))}. </> : null;
            })()}
          Counting links in either direction, it works with {x.all} of your {win ? "other " : ""}{x.of} plan cards{x.all ? `, ${x.lasting} of them with links that keep working` : ""}.
        </p>
        <button type="button" onClick={() => onCut(tap)} className="self-start min-h-8 text-xs text-(--accent) underline underline-offset-2">What if I cut {front(c?.name ?? tap)}?</button>
        <span className="eyebrow text-(--muted)">{win ? "Fed, in this plan, by" : "Feeds, in this plan"}</span>
        <Links ps={mine} giver={win ? null : tap} />
      </div>
    );
  }

  const row = (n: string) => {
    const ps = partnersOf(lens, n);
    const k = counts(ps);
    const isOpen = open === n;
    const top = ps.find((p) => !lastingOnly || p.lasting || p.combo);
    return (
      <li key={n} className={`flex gap-2 ${isOpen ? "rounded-(--radius) bg-(--surface-secondary) p-2" : ""}`} data-testid="plan-lens-row" data-card={n}>
        {card.get(n) ? <Art card={card.get(n)!} size={28} /> : null}
        <div className="flex min-w-0 flex-col gap-1">
          <span><b><CardName name={n} /></b></span>
          <span className="text-xs text-(--muted)">{meta(n)} · {inPlan.has(n) ? "fed by" : "feeds"} {k.all}, {k.lasting} lasting</span>
          <Chips ps={ps} lastingOnly={lastingOnly} />
          {isOpen ? <Links ps={ps} giver={inPlan.has(n) ? null : n} />
            : top ? <span className="text-xs text-(--muted)">{top.lasting ? "Keeps working: " : ""}{whyOf(top, inPlan.has(n) ? top.name : n)}</span> : null}
          {ps.length ? <button type="button" onClick={() => onOpen(n)} className="self-start min-h-8 text-xs text-(--accent)" aria-expanded={isOpen}>{isOpen ? "Hide the reasons" : "Why each one ›"}</button> : null}
        </div>
      </li>
    );
  };
  return (
    <div className={box} data-testid="plan-lens-panel">
      <h4 className="text-base font-semibold">{phrase}</h4>
      <p className="text-xs text-(--muted)">
        {lens.plan.length} cards in the plan, {lens.setup.length} set it up. Each card's partners in this plan:{" "}
        <Pc kind="last">keeps working</Pc> <Pc kind="once">once</Pc>{hasCombo ? <> <Pc kind="combo">combo</Pc> (the two loop together; a loop is counted apart from lasting links)</> : null}.
        {lastingOnly ? <> <b>Lasting links only:</b> once-only links are hidden; "Why each one" still lists every reason.</> : null}
      </p>
      <span className="eyebrow text-(--muted)">Cards in the plan</span>
      <ul className="flex flex-col gap-3">{lens.plan.map(row)}</ul>
      {lens.setup.length ? <>
        <span className="eyebrow text-(--muted)">Cards that set it up</span>
        <ul className="flex flex-col gap-3">{lens.setup.map(row)}</ul>
      </> : null}
    </div>
  );
}

function Pc({ kind, children }: { kind: "last" | "once" | "combo"; children: React.ReactNode }) {
  const cls = kind === "last" ? "border-(--edge) bg-(--surface-tertiary) text-(--foreground)"
    : kind === "combo" ? "border-[#D4A63A] text-[#D4A63A]" : "border-dashed border-(--edge) text-(--muted)";
  return <span className={`inline-block rounded border px-1.5 text-xs leading-normal ${cls}`}>{children}</span>;
}

const kindOf = (p: Partner) => (p.combo ? "combo" : p.lasting ? "last" : "once");

/** Once-only chips named on a row before the rest are folded into a count: a drain card fed by 34
 *  cards was a wall of 34 names. Every lasting partner is always named; "Why each one" lists all. */
const ONCE_NAMED = 6;

function Chips({ ps, lastingOnly }: { ps: Partner[]; lastingOnly: boolean }) {
  if (!ps.length) return null;
  const strong = ps.filter((p) => p.lasting || p.combo), weak = ps.filter((p) => !p.lasting && !p.combo);
  const named = lastingOnly ? [] : weak.slice(0, ONCE_NAMED);
  const hidden = weak.length - named.length;
  return (
    <span className="flex flex-wrap gap-1" data-testid="plan-lens-chips">
      {[...strong, ...named].map((p) => <Pc key={p.name} kind={kindOf(p)}>{front(p.name)}</Pc>)}
      {hidden ? <span className="inline-block rounded border border-dotted border-(--edge) px-1.5 text-xs text-(--muted)">+{hidden} once{lastingOnly ? ", hidden" : " more"}</span> : null}
    </span>
  );
}

/** A sentence about a token says whose token it is: "When Mark of the Rani enters, Forgeborn Oreads
 *  deals 1 damage" sat on The Rani's row with nothing tying the Mark to her (round 6). */
const whyOf = (p: Partner, giver: string) => (p.via ? `Through ${front(giver)}'s ${p.via} token: ${p.why}` : p.why);

/** Every partner with its sentence: what a reader checks against both cards' text. An opened list
 *  reads every reason whatever the switch says: opened under "Lasting links only" it once showed
 *  nothing but "+3 once, hidden" (round 6). `giver` is the card whose row it is when that card does
 *  the feeding; on a plan card's row each partner is the giver. */
function Links({ ps, giver }: { ps: Partner[]; giver: string | null }) {
  return (
    <ul className="flex flex-col gap-1.5" data-testid="plan-lens-links">
      {ps.map((p) => (
        <li key={p.name} className={`border-l-2 py-0.5 pl-2 text-xs ${p.combo ? "border-[#D4A63A]" : p.lasting ? "border-(--edge)" : "border-dashed border-(--edge) text-(--muted)"}`}>
          <b className="text-(--foreground)"><CardName name={p.name} /></b>{" "}
          <span className="font-mono text-[10px] text-(--muted)">{p.combo ? "combo loop" : p.lasting ? "keeps working" : "once"}</span>
          <br />{whyOf(p, giver ?? p.name)}
        </li>
      ))}
    </ul>
  );
}
