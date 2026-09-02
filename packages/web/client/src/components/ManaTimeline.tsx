import { scaleBand, scaleLinear } from "d3-scale";
import type { DeckReport } from "../types.js";
import { manaTimeline } from "../lib/mana-timeline.js";

/** Geometry, in the viewBox's own units. The chart scales to its container; these decide the
 *  PROPORTIONS between the two halves, not the size on screen. */
const W = 320;
const SUPPLY_H = 74;
const AXIS_H = 14;
const DEMAND_H = 42;
const H = SUPPLY_H + AXIS_H + DEMAND_H;

/** WHAT YOUR DECK ASKS FOR AND WHAT IT WILL HAVE, ON ONE TURN AXIS (roadmap S5, chapter 4).
 *
 *  THE TWO HALVES SHARE X AND NOTHING ELSE, on purpose. Supply is MANA and demand is CARDS -- two
 *  quantities, so they get two regions rather than one dual-scaled axis where a reader is invited
 *  to compare a height against a height that means something different. The turn line between them
 *  is the only thing they have in common, and it is the thing the panel is about.
 *
 *  WHERE A COST SITS IS MEASURED, NOT ASSUMED -- see `manaTimeline`. A bar under turn 7 means this
 *  deck's median mana does not cover that cost until turn 7, which on the review deck is two turns
 *  later than the on-curve convention would have drawn it.
 *
 *  THE BAND IS THE POINT. p25-p75 travels with the median everywhere it is shown, because a
 *  first-payable turn read off a median is not a promise about any one game -- a quarter of games
 *  sit below that band's floor. */
export function ManaTimeline({ curve, manaAvailability }: {
  curve: DeckReport["manaCurve"];
  manaAvailability: DeckReport["manaAvailability"];
}) {
  const t = manaAvailability ? manaTimeline(curve, manaAvailability.rows) : null;
  if (!t) return null;

  const x = scaleBand<number>()
    .domain(t.columns.map((c) => c.turn))
    .range([0, W])
    .paddingInner(0.25);
  const manaMax = Math.max(1, ...t.columns.map((c) => c.mana.p75));
  const y = scaleLinear().domain([0, manaMax]).range([SUPPLY_H, 0]);
  const countMax = Math.max(1, ...t.columns.map((c) => c.unlocked));
  const yCount = scaleLinear().domain([0, countMax]).range([0, DEMAND_H]);
  const mid = (turn: number) => (x(turn) ?? 0) + x.bandwidth() / 2;

  const bandArea =
    t.columns.map((c, i) => `${i === 0 ? "M" : "L"}${mid(c.turn)},${y(c.mana.p75)}`).join(" ") +
    " " +
    [...t.columns].reverse().map((c) => `L${mid(c.turn)},${y(c.mana.p25)}`).join(" ") +
    " Z";
  const medianLine = t.columns
    .map((c, i) => `${i === 0 ? "M" : "L"}${mid(c.turn)},${y(c.mana.median)}`)
    .join(" ");

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <h3 className="eyebrow">What it asks for, and what it will have</h3>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-[520px]"
        role="img"
        aria-label={
          `Mana available by turn against the cards it pays for. ` +
          t.columns.map((c) => `turn ${c.turn}: ${c.mana.median} mana, ${c.unlocked} cards become payable`).join("; ") +
          (t.never.count > 0 ? `. ${t.never.count} cards cost more than the median makes by turn ${t.never.afterTurn}` : "")
        }
      >
        {/* SUPPLY, ABOVE THE LINE. The band first so the median reads on top of it. */}
        <path d={bandArea} fill="var(--fill)" opacity={0.35} />
        <path d={medianLine} fill="none" stroke="var(--fill)" strokeWidth={2} strokeLinejoin="round" />
        {t.columns.map((c) => (
          <circle key={c.turn} cx={mid(c.turn)} cy={y(c.mana.median)} r={2.5} fill="var(--fill)" />
        ))}

        <line x1={0} y1={SUPPLY_H} x2={W} y2={SUPPLY_H} stroke="var(--separator)" strokeWidth={1} />

        {t.columns.map((c) => (
          <text
            key={c.turn}
            x={mid(c.turn)}
            y={SUPPLY_H + AXIS_H - 3}
            textAnchor="middle"
            className="stat-num"
            fontSize={9}
            fill="var(--muted)"
          >
            {c.turn}
          </text>
        ))}

        {/* DEMAND, BELOW IT, growing DOWNWARD from the same line -- so the eye reads "this many
          *  cards arrive under this much mana" without being asked to compare two heights that
          *  measure different things. */}
        {t.columns.map((c) => {
          if (c.unlocked === 0) return null;
          const h = yCount(c.unlocked);
          // THE COUNT ON THE BAR WHERE IT FITS, the same rule `TypeBar` set: below some height the
          // digits either overflow the bar or get clipped, and half a number is worse than none.
          // The rest are carried by the chart's own `aria-label` and by the curve panel below.
          const inPlace = h >= 12;
          return (
            <g key={c.turn}>
              <rect
                data-testid={`timeline-bar-${c.turn}`}
                x={x(c.turn) ?? 0}
                y={SUPPLY_H + AXIS_H}
                width={x.bandwidth()}
                height={h}
                rx={1}
                /* --muted, NOT --fill: supply is drawn in --fill above the same line, and two
                 * series a reader is meant to tell apart cannot share a colour. Not an accent
                 * either -- a bar is a large area, and index.css reserves the accent for scarce
                 * marks. */
                fill="var(--muted)"
              />
              {inPlace ? (
                <text
                  x={mid(c.turn)}
                  y={SUPPLY_H + AXIS_H + h - 4}
                  textAnchor="middle"
                  className="stat-num"
                  fontSize={8}
                  fill="var(--background)"
                  aria-hidden
                >
                  {c.unlocked}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      <p className="text-xs text-(--muted) max-w-[56ch]">
        Above the line: mana by turn, median with the quarter-to-three-quarter band around it. Below
        it: how many cards that much mana first pays for. A cost sits on the turn this deck actually
        covers it, not on the turn its number happens to match.
      </p>

      {/* THE ONE GENERATED SENTENCE, and it is the WORST intersection rather than a summary.
        *  Stranded cards outrank a busy turn: a turn where a lot arrives is a deck working, while a
        *  cost the deck never covers is a card that does not get cast. Silent when neither is true,
        *  because a panel that always has a complaint is not read as one. */}
      {t.never.count > 0 ? (
        <p className="text-sm">
          <span className="text-(--warning)">
            {t.never.count} card{t.never.count === 1 ? "" : "s"} cost more than this deck&rsquo;s
            median makes by turn {t.never.afterTurn}
          </span>
          <span className="text-(--muted)">
            {" "}— half your games reach less than that.
          </span>
        </p>
      ) : t.peak && t.peak.count >= 10 ? (
        <p className="text-sm text-(--muted)">
          Turn {t.peak.turn} is where the most arrives: {t.peak.count} cards become payable at once.
        </p>
      ) : null}
    </div>
  );
}
