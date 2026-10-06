import { useId, useState } from "react";
import { menuExtras } from "./pop-menu.js";
import type { EngineCard, EngineModel, Link } from "../lib/engine-model.js";
import { displayName } from "../lib/engine-model.js";
import { CardName, ReasonText, useCardDrawer } from "./card-drawer.js";

/** Cards outside the loop drawn under it. */
const PAYOFFS = 3;
const RANK: Record<Link["repeat"], number> = { static: 0, triggered: 1, activated: 2, oneshot: 3 };

export interface ComboParts {
  pieces: EngineCard[];
  /** One sentence per side of the loop, piece i to piece i+1; null where the engine read none. */
  sides: (Link | null)[];
  /** Deck cards that work with two or more pieces: what each lap pays. */
  payoffs: { card: EngineCard; link: Link; reach: number; with: string[] }[];
}

/** The loop's pieces as the engine knows them, the sentence on each side, and the cards that work
 *  with two or more of its pieces. Null when a piece is not in the model.
 *
 *  `winners` are the report's own payoffs for this loop (`combo.payoffs`): the cards that turn what
 *  it repeats into a win. They lead, and need only one link to a piece; the rest still need two. */
export function comboParts(cards: readonly string[], m: EngineModel, winners: readonly string[] = []): ComboParts | null {
  const byName = new Map<string, EngineCard>();
  for (const c of m.cards.values()) {
    if (c.isFace || c.isToken) continue;
    if (!byName.has(c.name)) byName.set(c.name, c);
    if (!byName.has(c.physical)) byName.set(c.physical, c);
  }
  const pieces = cards.map((n) => byName.get(n));
  if (pieces.some((p) => !p)) return null;
  const ps = pieces as EngineCard[];
  const linksOf = (a: EngineCard, b: EngineCard) => m.partners.get(a.id)?.get(b.id)?.links ?? [];
  const best = (ls: readonly Link[]) => [...ls].sort((x, y) => RANK[x.repeat] - RANK[y.repeat])[0] ?? null;
  const sides = ps.map((a, i) => (ps.length < 2 ? null : best(linksOf(a, ps[(i + 1) % ps.length]!))));
  const inLoop = new Set(ps.map((p) => p.id));
  const payoffs: ComboParts["payoffs"] = [];
  const wins = new Set(winners);
  for (const c of byName.values()) {
    if (inLoop.has(c.id) || payoffs.some((p) => p.card.id === c.id)) continue;
    const touched = ps.filter((p) => linksOf(c, p).length > 0 || linksOf(p, c).length > 0);
    if (touched.length < (wins.has(c.name) || wins.has(c.physical) ? 1 : 2)) continue;
    const link = best(touched.flatMap((p) => [...linksOf(c, p), ...linksOf(p, c)]));
    if (link) payoffs.push({ card: c, link, reach: touched.length, with: touched.map((p) => p.id) });
  }
  const isWin = (p: ComboParts["payoffs"][number]) => wins.has(p.card.name) || wins.has(p.card.physical);
  payoffs.sort((a, b) => Number(isWin(b)) - Number(isWin(a)) || b.reach - a.reach || b.card.score - a.card.score);
  return { pieces: ps, sides, payoffs: payoffs.slice(0, PAYOFFS) };
}

/** THE DECK'S COMBO DRAWN AS THE MOCKUP DRAWS IT (Combo mockup, 2026-09-27): the pieces on a loop,
 *  each side numbered and said in one sentence beside it, what it repeats in Commander
 *  Spellbook's words, and under the loop the cards that turn each lap into something. */
export function ComboFeature({ parts, result, manaValue, cheap, wins }: {
  parts: ComboParts; result: string; manaValue: number; cheap: boolean;
  /** The deck's cards that turn this loop into a win (`combo.payoffs`); undefined says nothing. */
  wins?: readonly string[];
}) {
  const { open, known, walkFrom } = useCardDrawer();
  // THE MAP RULE (#1003; owner, 2026-10-03): the first click on a piece opens the card, the second
  // walks the commander's map from it.
  const [sel, setSel] = useState<string | null>(null);
  const clip = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const { pieces, sides, payoffs } = parts;
  const W = 460, H = payoffs.length ? 400 : 290, cx = W / 2, cy = 140, R = 110, r = 34, pr = 20;
  const n = pieces.length;
  const at = pieces.map((_, i) => {
    const t = -Math.PI / 2 + (i * 2 * Math.PI) / n + (n === 2 ? Math.PI / 2 : 0);
    return { x: cx + Math.cos(t) * R, y: cy + Math.sin(t) * R };
  });
  const payAt = payoffs.map((_, i) => ({ x: (W / (payoffs.length + 1)) * (i + 1), y: H - 62 }));
  const results = result.split(", ").filter(Boolean);
  const openable = (c: EngineCard) => (known.has(c.name) ? c.name : known.has(c.physical) ? c.physical : null);
  const disc = (c: EngineCard, x: number, y: number, rad: number, key: string, ring: string) => {
    const name = openable(c);
    const walk = walkFrom(c.id);
    const tap = () => { if (sel === c.id && walk) walk(); else { setSel(c.id); open(name!); } };
    return (
      // A NODE IS A BUTTON, AS ON THE ORBIT (#1003): it opened the card on a mouse click only, and a
      // keyboard or screen reader could not reach it.
      <g key={key} className={name ? "cursor-pointer outline-none focus-visible:[&>circle:last-of-type]:stroke-(--focus)" : undefined}
        {...(name ? {
          role: "button", tabIndex: 0, "aria-label": `Read ${displayName(c)}`, "data-card": name,
          ref: (el: SVGGElement | null) => { if (el && walk) menuExtras.set(el, () => [{ label: "Walk the map from here", run: walk }]); },
          onClick: tap,
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(); } },
        } : {})}>
        <clipPath id={`${clip}-${key}`}><circle cx={x} cy={y} r={rad} /></clipPath>
        <circle cx={x} cy={y} r={rad} fill="var(--surface-secondary)" />
        {c.art ? <image href={c.art} x={x - rad} y={y - rad} width={rad * 2} height={rad * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip}-${key})`} /> : null}
        <circle cx={x} cy={y} r={rad} fill="none" stroke={ring} strokeWidth={2.5} />
      </g>
    );
  };
  const short = (c: EngineCard) => displayName(c).split(" // ")[0]!.split(",")[0]!;
  return (
    <div data-testid="combo-feature" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-start">
      <div className="flex flex-col gap-3 text-sm">
        <ol className="flex flex-col gap-2">
          {/* EACH STEP ONCE (#1034): Rani's Dualcaster loop printed ① and ② word for word the same. */}
          {sides.map((l, i) => l && !sides.slice(0, i).some((x) => x?.text === l.text) ? (
            <li key={i} className="flex items-center gap-2.5">
              <span aria-hidden="true" className="pip shrink-0">{i + 1}</span>
              <span><ReasonText text={l.text} /></span>
            </li>
          ) : null)}
        </ol>
        {results.length ? (
          <div className="flex flex-col gap-1.5">
            <span className="eyebrow text-(--muted)">What it repeats (Commander Spellbook)</span>
            <span className="flex flex-wrap gap-1">
              {results.map((x) => <span key={x} className="rounded-(--radius) border border-(--separator) px-2 py-0.5 text-xs">{x}</span>)}
            </span>
          </div>
        ) : null}
        {/* WHAT KILLS (#1034): "what it repeats" never said which card turns the loop into a win. */}
        {wins?.length ? (
          <p>Wins through {wins.map((n, i) => <span key={n}>{i > 0 ? ", " : ""}<CardName name={n} /></span>)}</p>
        ) : wins ? (
          <p className="text-(--muted)">No card here was found that turns what the loop repeats into a win.</p>
        ) : null}
        {payoffs[0] ? (
          <p><span className="text-(--muted)">Outside the loop, each lap pays: </span><ReasonText text={payoffs[0].link.text} /></p>
        ) : null}
        <span className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="stat-num text-(--muted)">{manaValue} mana together</span>
          {cheap ? <span className="text-(--accent)">early enough to rule out bracket 3</span> : null}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full max-w-[28rem]" role="group"
        aria-label={`${pieces.map(displayName).join(" + ")}, a loop${payoffs.length ? `; outside it, ${payoffs.map((p) => displayName(p.card)).join(", ")}` : ""}`}>
        {payoffs.map((p, i) => pieces.map((c, j) => (
          p.with.includes(c.id) ? <line key={`${i}-${j}`} x1={payAt[i]!.x} y1={payAt[i]!.y} x2={at[j]!.x} y2={at[j]!.y} stroke="var(--edge)" strokeWidth={1} opacity={0.6} /> : null
        )))}
        {at.map((a, i) => {
          const b = at[(i + 1) % n]!;
          if (n < 2 || (n === 2 && i === 1)) return null;
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          return (
            <g key={`side-${i}`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--accent)" strokeWidth={2.5} strokeDasharray="7 6" />
              {sides[i] ? (
                <>
                  <circle cx={mx} cy={my} r={11} fill="var(--background)" stroke="var(--accent)" strokeDasharray="3 2" />
                  <text x={mx} y={my + 4} textAnchor="middle" fontSize={11} fill="var(--foreground)">{i + 1}</text>
                </>
              ) : null}
            </g>
          );
        })}
        {pieces.map((c, i) => (
          <g key={c.id}>
            {disc(c, at[i]!.x, at[i]!.y, r, `p${i}`, "var(--accent)")}
            <text x={at[i]!.x} y={at[i]!.y + r + 16} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--foreground)">{short(c)}</text>
          </g>
        ))}
        {payoffs.map((p, i) => (
          <g key={p.card.id}>
            {disc(p.card, payAt[i]!.x, payAt[i]!.y, pr, `o${i}`, "var(--edge)")}
            <text x={payAt[i]!.x} y={payAt[i]!.y + pr + 15} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--foreground)">{short(p.card)}</text>
            <text x={payAt[i]!.x} y={payAt[i]!.y + pr + 29} textAnchor="middle" fontSize={10} fill="var(--muted)">{p.reach === n ? `works with all ${n}` : `works with ${p.reach} of ${n}`}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
