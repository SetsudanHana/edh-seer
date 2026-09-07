import { useState } from "react";
import { scaleBand, scaleLinear } from "d3-scale";
import type { DeckReport } from "../types.js";
import { policyBand } from "@edh-seer/engine/percent";

const W = 320;
const H = 88;
/** Room for the share axis (0 / 50 / 100%). Every chart has its axis and a readout -- owner,
 *  2026-09-06; the sibling `ManaTimeline` carries the same shape. */
const ML = 28;

/** MANA AVAILABILITY — a seeded goldfish simulation, not a formula (roadmap I11's report wiring).
 *
 *  AN INTERVAL AND NEVER A POINT, because the model's own falsifier fired before this panel existed:
 *  policy sensitivity measured 27.6pp against a 32.7pp median ramp signal, so mana availability is a
 *  POLICY property at deck scale. The headline shows both ends or it shows nothing.
 *
 *  THE PER-TURN ROWS ARE NOT A SECOND INTERVAL, and that is a finding rather than a shortcut: the
 *  two policies agree on every median and disagree only in the tail. A per-row policy range would
 *  print "15% – 15%" eight times and hide the sensitivity where nobody looks.
 *
 *  NOT THE PER-CARD CASTABILITY FIGURE. That one is colour-aware and counts lands; this is
 *  colour-blind and models ramp and tapped lands. Neither contains the other, and the measured fact
 *  is that castability's interval does not contain this answer on a green land-ramp deck — which is
 *  why `DeckIdentity` names this number rather than leaving a reader to pick. */
export function ManaAvailability({ manaAvailability }: { manaAvailability: DeckReport["manaAvailability"] }) {
  const [pick, setPick] = useState<number | null>(null);
  if (!manaAvailability || manaAvailability.rows.length === 0) return null;
  const m = manaAvailability;
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const x = scaleBand<number>().domain(m.rows.map((r) => r.turn)).range([ML, W]).paddingInner(0.25);
  const mid = (turn: number): number => (x(turn) ?? 0) + x.bandwidth() / 2;
  // A SHARE IS ALWAYS 0-1, so the axis is the whole range and not the data's own maximum: a deck
  // that peaks at 40% must LOOK like it peaks at 40%, which a fitted axis would hide.
  const y = scaleLinear().domain([0, 1]).range([H - 12, 4]);
  const bandArea =
    m.rows.map((r, i) => `${i === 0 ? "M" : "L"}${mid(r.turn)},${y(r.payableShare.p75)}`).join(" ")
    + " "
    + [...m.rows].reverse().map((r) => `L${mid(r.turn)},${y(r.payableShare.p25)}`).join(" ")
    + " Z";
  const medianLine = m.rows
    .map((r, i) => `${i === 0 ? "M" : "L"}${mid(r.turn)},${y(r.payableShare.median)}`)
    .join(" ");
  // The headline's turn is the default readout: the number the panel leads with, on the chart.
  const shownTurn = pick ?? (m.rows.some((r) => r.turn === m.headline.turn) ? m.headline.turn : m.rows[m.rows.length - 1]?.turn);
  const shown = m.rows.find((r) => r.turn === shownTurn);
  const describe = (r: (typeof m.rows)[number]) =>
    `turn ${r.turn}: ${pct(r.payableShare.median)} of the deck payable (${pct(r.payableShare.p25)}–${pct(r.payableShare.p75)})`;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Mana availability</h3>
      <div className="flex items-baseline gap-3">
        {/* ONE FIGURE WHEN THE TWO POLICIES AGREE, never "100% – 100%". The precedent is
          *  `castability.ts`'s own range, which collapses on 18.9% of rows and prints a single
          *  number there: a range whose ends are equal is not a range, and printing it as one makes
          *  a reader look for a difference that is not there. */}
        <span className="stat-num text-2xl">
          {policyBand(m.headline.low, m.headline.high)}
        </span>
        <span className="text-xs text-(--muted)">
          to make {m.headline.mana} mana by turn {m.headline.turn}
        </span>
      </div>
      <p className="text-sm text-(--muted)">
        {m.trials.toLocaleString()} simulated games, {m.accelerants} accelerants in the deck. The range is
        the <strong>play policy</strong>: the low end holds up two mana, the high end spends everything
        on acceleration and is a ceiling no real deck plays to.
      </p>

      {/* THE TABLE WAS TWO SERIES OF NUMBERS AND ONE OF THEM WAS ALREADY DRAWN (roadmap T17).
        *  Owner: *"mana availability is just a table with numbers, it can be presented better"*.
        *
        *  THE MANA COLUMN IS DELETED RATHER THAN CHARTED, because `ManaTimeline` in this same
        *  chapter already draws median mana per turn with the same p25-p75 band, off the same
        *  `manaAvailability.rows`. Charting it here would have been a third picture of one number.
        *
        *  WHAT WAS NEVER DRAWN is the share of the deck this turn's mana can pay for, and that is
        *  the series below. Same idiom as the supply band four panels up -- area for p25-p75,
        *  2px median line on top -- so a reader meets one visual grammar and not two. One series,
        *  so no legend: the heading names it. The numbers stay reachable in the `aria-label`, which
        *  is the table view this replaces. */}
      {/* CAPPED LIKE ITS SIBLING (T11). A `viewBox` scales height with width, so left at `w-full` in
        *  a 950px column this 320x88 chart renders about 260px tall -- a band chart that tall is a
        *  different picture. `ManaTimeline` four panels up carries the same cap, so the two read as
        *  a pair rather than as two unrelated sizes. */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-[520px] h-auto"
        role="img"
        aria-label={
          "Share of the deck payable, by turn: "
          + m.rows.map((r) => `turn ${r.turn}, ${pct(r.payableShare.median)} (${pct(r.payableShare.p25)} to ${pct(r.payableShare.p75)})`).join("; ")
        }
      >
        {[0, 0.5, 1].map((tick) => (
          <g key={tick} data-testid="y-tick">
            <line x1={ML} x2={W} y1={y(tick)} y2={y(tick)} stroke="var(--separator)" strokeWidth={0.5} />
            <text x={ML - 3} y={y(tick)} textAnchor="end" dominantBaseline="middle" className="stat-num fill-(--muted)" fontSize={8}>{pct(tick)}</text>
          </g>
        ))}
        <path d={bandArea} fill="var(--fill)" opacity={0.18} />
        <path d={medianLine} fill="none" stroke="var(--fill)" strokeWidth={2} strokeLinejoin="round" />
        {shown ? <line x1={mid(shown.turn)} x2={mid(shown.turn)} y1={0} y2={H - 12} stroke="var(--muted)" strokeWidth={0.75} strokeDasharray="2 2" /> : null}
        {m.rows.map((r) => (
          <circle key={r.turn} cx={mid(r.turn)} cy={y(r.payableShare.median)} r={r.turn === shownTurn ? 4 : 2.5} fill="var(--fill)" />
        ))}
        {/* TURN NUMBERS ONLY, and the ends of the value range -- never a label on every point. */}
        {m.rows.map((r) => (
          <text
            key={r.turn}
            x={mid(r.turn)}
            y={H - 2}
            textAnchor="middle"
            className="fill-(--muted)"
            style={{ fontSize: 9 }}
          >
            {r.turn}
          </text>
        ))}
        {m.rows.map((r) => (
          <rect
            key={r.turn}
            data-testid={`availability-col-${r.turn}`}
            x={x(r.turn) ?? 0} y={0} width={x.bandwidth()} height={H}
            fill="transparent" tabIndex={0} aria-label={describe(r)}
            className="outline-none cursor-crosshair"
            onPointerEnter={() => setPick(r.turn)} onFocus={() => setPick(r.turn)} onClick={() => setPick(r.turn)}
          >
            <title>{describe(r)}</title>
          </rect>
        ))}
      </svg>
      {shown ? (
        <p className="text-xs stat-num" data-testid="availability-readout">
          Turn {shown.turn} · {pct(shown.payableShare.median)} of the deck payable ({pct(shown.payableShare.p25)}–{pct(shown.payableShare.p75)})
        </p>
      ) : null}

      <p className="text-xs text-(--muted)">
        The line is the median share of your nonlands this turn's mana can pay for, under the
        spend-everything policy; the band is p25–p75. Colour is ignored
        entirely, so this is <strong>mana</strong> and never castability — a {"{3}{R}{G}{W}"} spell
        needs three specific colours nothing here checks.
      </p>
    </div>
  );
}
