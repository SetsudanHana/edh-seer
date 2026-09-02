import type { GaugeReading, GaugeTone } from "../lib/deck-gauge.js";
import { ZONES } from "./Dial.js";

/** Where a target sits on a count track, as a fraction of its width.
 *
 *  MOVED HERE FROM `BuildBenchmarks`, WHERE ITS ONLY CALLER IS DEAD CODE (`ungrouped`, empty on
 *  every deck because `BASE_TARGETS` gives burn and stax a target of 0). The reasoning is that
 *  file's and is unchanged: a bar that CLAMPS at its target paints `13/10`, `4/4`, `14/10`, `1/1`
 *  and `37/36` as one identical full-width bar -- five of six rows carrying no information, and a
 *  land count 4 OVER drawing exactly like a ramp count 1 UNDER. Parking the target at 70% leaves
 *  30% for overshoot, so clearing a floor visibly runs past the mark and missing it stops short.
 *
 *  AND EVERY ROW'S MARK SITS AT THE SAME X, which is the property that makes rows with different
 *  targets comparable at a glance -- the thing a row of gauges could not do, because each dial
 *  carried its own private scale. */
export const TARGET_MARK = 0.7;

const TONE_FILL: Record<GaugeTone, string> = {
  danger: "var(--danger)",
  warning: "var(--warning)",
  success: "var(--success)",
  neutral: "var(--muted)",
};

const TONE_TEXT: Record<GaugeTone, string> = {
  danger: "text-(--danger)",
  warning: "text-(--warning)",
  success: "text-(--success)",
  neutral: "text-(--muted)",
};

/** ONE MEASURE AS A BAR AGAINST ITS OWN REFERENCE -- the shape a gauge was standing in for.
 *
 *  A DIAL IS RIGHT FOR A SCORE AND WRONG FOR AN INPUT. The two lead dials (Synergy, Build) each
 *  stand for a whole group and are read one at a time; the seven measures beneath them are read
 *  AGAINST EACH OTHER, and a row of arcs is the one form that makes that comparison hard -- each
 *  needle carries its own private scale, so "Ramp 9" and "Interaction 4" point at unrelated
 *  angles. Bars share a baseline. (Owner direction, 2026-09-02.)
 *
 *  IT OWNS NO THRESHOLD. `reading` comes from `deck-gauge.ts` exactly as the dial's does -- the
 *  same `floorState`/`bandState`/`scoreState`, the same tone table, the same words. This file
 *  decides only how wide things are drawn, which is what `ZONES` already says for the arc. */
export function Bullet({ name, value, reading, fill, mark, zones, note, onOpen, openLabel }: {
  name: string;
  /** The figure itself, printed. Never derived from `fill` -- that is a width, not a number. */
  value: string;
  reading: GaugeReading;
  /** How much of the track the bar covers, 0-1. */
  fill: number;
  /** Where the reference tick sits, 0-1, when the measure HAS one. A score has none: there is no
   *  target for "breadth 1.3", only bands, so drawing a tick would invent a number. */
  mark?: number;
  /** Qualitative bands behind the bar, in the same -1..1 space `GaugeReading.position` uses.
   *  Present for a score (whose meaning IS its band) and absent for a count against a floor, where
   *  the tick is the reference and a band behind it would be a second, unmeasured one. */
  zones?: "score";
  /** One line under the bar, for a reference that needs to say whose it is. */
  note?: string;
  /** Opens this measure's own detail, exactly as the dial it replaces did. Absent when there is
   *  nothing to open -- see the button/div split below. */
  onOpen?: () => void;
  openLabel?: string;
}) {
  const pct = (n: number) => `${+(Math.max(0, Math.min(1, n)) * 100).toFixed(2)}%`;
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm truncate">{name}</span>
        <span className="stat-num text-lg shrink-0">{value}</span>
      </div>
      {/* THE TICK LIVES OUTSIDE THE CLIPPING BOX. The track rounds its fill, which needs
        *  `overflow-hidden`, and that same clip cut the tick down to the bar's own height -- so the
        *  reference mark read as a SEAM in the bar rather than as a landmark beside it. The rounded
        *  track keeps its clip; the tick is a sibling over it, free to overhang. */}
      <span className="relative block w-full py-1">
      <span className="relative block w-full h-2 rounded-full bg-(--separator) overflow-hidden">
        {/* The bands go BEHIND the bar, never over it: they qualify the value, they are not the
          *  value. Drawn from the same `ZONES` table the dial's arc uses, mapped out of the
          *  -1..1 reading space into the track's 0..1. */}
        {zones
          ? ZONES[zones].map((z) => (
              <span
                key={`${z.from}`}
                aria-hidden
                data-zone={z.tone}
                className="absolute inset-y-0 opacity-25"
                style={{
                  left: pct((z.from + 1) / 2),
                  width: pct((z.to - z.from) / 2),
                  background: TONE_FILL[z.tone],
                }}
              />
            ))
          : null}
        <span
          data-testid="bullet-fill"
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: pct(fill), background: TONE_FILL[reading.tone] }}
        />
      </span>
        {mark !== undefined ? (
          <span
            data-testid="bullet-mark"
            aria-hidden
            className="absolute inset-y-0 w-0.5 rounded-full bg-(--foreground)"
            style={{ left: pct(mark) }}
          />
        ) : null}
      </span>
      {/* THE STATE IN WORDS, never carried by the bar's colour alone (WCAG 1.4.1) -- the same
        *  sentence the dial printed, from the same reading. */}
      {/* data-tone ON THE LABEL, not on the card, and this is `Dial`'s own contract rather than a
        *  choice: its comment says the attribute exists "so a test can pin it independent of the
        *  wording". Hung on the wrapper instead, the element's `textContent` is the whole card
        *  ("Ramp9on target"), and three existing assertions comparing `{label, tone}` pairs broke
        *  on exactly that. */}
      <span data-tone={reading.tone} className={`text-xs ${TONE_TEXT[reading.tone]}`}>{reading.label}</span>
      {note ? <span className="text-xs text-(--muted)">{note}</span> : null}
    </>
  );

  const shell = "flex flex-col gap-1 rounded-lg border border-(--separator) p-3";

  // A MEASURE WITH NOWHERE TO GO IS NOT A BUTTON -- `Dial`'s rule, kept, because the affordance is
  // the thing being replaced and not the reason for replacing it. Dropping `onOpen` in the swap
  // silently deleted the page's route from a role's count to that role's own leaves; two tests
  // caught it.
  if (!onOpen) return <div className={`${shell} min-w-0`} data-testid={`bullet-${name}`}>{body}</div>;

  // The 44px target-size floor (WCAG 2.5.8), stated on both axes exactly as the dial states it.
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`bullet-${name}`}
      aria-label={`${name}, ${value}, ${reading.label} — open ${openLabel}`}
      className={`${shell} min-w-[44px] min-h-[44px] text-left hover:border-(--accent) focus-visible:outline-2 focus-visible:outline-(--accent)`}
    >
      {body}
    </button>
  );
}
