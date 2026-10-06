import { useId } from "react";
import { CardName, useCardDrawer } from "./card-drawer.js";

/** Results a loop leads with; the rest are counted. */
const RESULTS_SHOWN = 3;

/** ONE INFINITE COMBO AS A CLOSED LOOP (report cohesion audit, 2026-09-27: "rely more on data
 *  visualisation than the text"). Its pieces sit on one dashed ring, the ring is the loop, and the
 *  arrow on it says the loop turns. Beside it: the pieces by name, what it repeats in Commander
 *  Spellbook's words, and what the pieces cost together. A cheap one is marked, since that is what
 *  rules bracket 3 out. */
export function ComboLoop({ cards, result, manaValue, cheap, artOf, wins }: {
  cards: string[]; result: string; manaValue: number; cheap: boolean;
  /** The deck's cards that turn this loop into a win (`combo.payoffs`); undefined says nothing. */
  wins?: readonly string[];
  artOf?: (name: string) => string | undefined;
}) {
  const { open, known } = useCardDrawer();
  const clip = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const W = 116, cx = W / 2, cy = W / 2, R = 36;
  const n = cards.length;
  const r = Math.min(20, R * Math.sin(Math.PI / Math.max(n, 2)) - 2);
  const at = cards.map((_, i) => {
    const t = -Math.PI / 2 + (i * 2 * Math.PI) / n + (n === 2 ? Math.PI / 2 : 0);
    return { x: cx + Math.cos(t) * R, y: cy + Math.sin(t) * R };
  });
  // The arrow sits halfway between the first two pieces, pointing along the ring.
  const t0 = -Math.PI / 2 + (n === 2 ? Math.PI / 2 : 0) + Math.PI / n;
  const ax = cx + Math.cos(t0) * R, ay = cy + Math.sin(t0) * R;
  const deg = (t0 * 180) / Math.PI + 90;
  const results = result.split(", ").filter(Boolean);
  return (
    <li data-testid="bracket-combo" className="flex items-center gap-3 rounded-(--radius) border border-(--separator) p-2">
      <svg viewBox={`0 0 ${W} ${W}`} width={W} height={W} className="shrink-0" aria-hidden="true">
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="5 4" />
        <path d="M -5 -4 L 5 0 L -5 4 z" fill="var(--accent)" transform={`translate(${ax} ${ay}) rotate(${deg})`} />
        {cards.map((name, i) => {
          const p = at[i]!, art = artOf?.(name);
          return (
            <g key={name} className={known.has(name) ? "cursor-pointer" : undefined} data-card={known.has(name) ? name : undefined} onClick={known.has(name) ? () => open(name) : undefined}>
              <clipPath id={`${clip}-${i}`}><circle cx={p.x} cy={p.y} r={r} /></clipPath>
              <circle cx={p.x} cy={p.y} r={r} fill="var(--surface-secondary)" />
              {art ? <image href={art} x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip}-${i})`} /> : null}
              <circle cx={p.x} cy={p.y} r={r} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
            </g>
          );
        })}
      </svg>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm">
          {cards.map((name, i) => <span key={name}>{i > 0 ? " + " : ""}<CardName name={name} /></span>)}
        </span>
        <span className="text-xs text-(--muted)" title={result}>
          {results.slice(0, RESULTS_SHOWN).join(" · ")}
          {results.length > RESULTS_SHOWN ? ` +${results.length - RESULTS_SHOWN} more` : ""}
        </span>
        {/* WHAT KILLS (#1034): the row said what repeats and never what turns it into a win. */}
        {wins ? (wins.length
          ? <span className="text-xs">Wins through {wins.map((n, i) => <span key={n}>{i > 0 ? ", " : ""}<CardName name={n} /></span>)}</span>
          : <span className="text-xs text-(--muted)">No card here turns it into a win</span>) : null}
        <span className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="stat-num text-(--muted)">{manaValue} mana together</span>
          {cheap ? <span className="text-(--accent)">early enough to rule out bracket 3</span> : null}
        </span>
      </div>
    </li>
  );
}
