import { scaleLinear } from "d3-scale";
import type { GaugeReading, GaugeTone } from "../lib/deck-gauge.js";
import { TONE_OF_SCORE } from "../lib/deck-gauge.js";
import { scoreBand, SCORE_BREAKS } from "../lib/score-band.js";

/** ONE SEMICIRCLE, drawn from trig rather than from `d3-shape`.
 *
 *  The repo's standing rule is to reuse d3 for anything visualising data, and the value-to-angle
 *  map below is `d3-scale`, which is already a dependency. `d3-shape` is NOT, and adding a package
 *  to emit six lines of arc path for one fixed geometry buys nothing -- there is no stacking, no
 *  layout, no interpolation here, only a constant-radius sweep. */
const R = 46;
const RING_INNER = R - 9;
const CX = 50;
const CY = 50;

const angle = scaleLinear().domain([-1, 1]).range([-Math.PI, 0]);

function pointAt(a: number, r: number): [number, number] {
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

/** A constant-radius ring segment: out along the start angle, round the outer edge, back along the
 *  end angle, round the inner edge. `large-arc` is 0 throughout because no zone of a four- or
 *  five-band semicircle ever exceeds a half turn. */
function ringPath(from: number, to: number, inner: number, outer: number): string {
  const [x1, y1] = pointAt(from, outer);
  const [x2, y2] = pointAt(to, outer);
  const [x3, y3] = pointAt(to, inner);
  const [x4, y4] = pointAt(from, inner);
  return `M${x1} ${y1} A${outer} ${outer} 0 0 1 ${x2} ${y2} L${x3} ${y3} A${inner} ${inner} 0 0 0 ${x4} ${y4} Z`;
}

const TONE_FILL: Record<GaugeTone, string> = {
  danger: "var(--danger)",
  warning: "var(--warning)",
  success: "var(--success)",
  neutral: "var(--muted)",
};

/** THE ZONES OF EACH KIND OF DIAL, in needle-space (-1 … 1).
 *
 *  `floor` and `band` mirror `deck-gauge.ts`'s buckets exactly and carry no thresholds of their own
 *  -- the module owns every number, this owns only how wide each band is drawn. `floor` is
 *  asymmetric because the measurement is (see `floorState`); `band` is symmetric because lands
 *  genuinely are. `score` is built below, not written down, because its thresholds are
 *  `SCORE_BREAKS` and a hand-copied literal would go stale the day that array moves. */
const FLOOR_ZONES: { from: number; to: number; tone: GaugeTone }[] = [
  { from: -1, to: -0.6, tone: "danger" },
  { from: -0.6, to: -0.2, tone: "warning" },
  { from: -0.2, to: 0.4, tone: "success" },
  { from: 0.4, to: 1, tone: "neutral" },
];

const BAND_ZONES: { from: number; to: number; tone: GaugeTone }[] = [
  { from: -1, to: -0.6, tone: "danger" },
  { from: -0.6, to: -0.2, tone: "warning" },
  { from: -0.2, to: 0.2, tone: "success" },
  { from: 0.2, to: 0.6, tone: "warning" },
  { from: 0.6, to: 1, tone: "danger" },
];

/** The same `(score / 5) * 2 - 1` map `scoreState` uses, applied to `SCORE_BREAKS` so the arc's
 *  boundaries move with the bands instead of copying their positions by hand. */
function scorePosition(score: number): number {
  return (score / 5) * 2 - 1;
}

/** `SCORE_BREAKS` cuts [0, 5] into four bands (Unfocused/Developing/Focused/Tuned). Mapped to
 *  needle-space that is four spans; `Focused` and `Tuned` both carry `success` (`TONE_OF_SCORE`),
 *  so drawn as four arcs the dial would show an invisible boundary -- one band pretending to be
 *  two. Adjacent spans sharing a tone are merged here, which is what makes the score dial draw
 *  three zones for four bands. */
function buildScoreZones(): { from: number; to: number; tone: GaugeTone }[] {
  const edges = [-1, ...SCORE_BREAKS.map(scorePosition), 1];
  const spans = edges.slice(0, -1).map((from, i) => {
    const to = edges[i + 1];
    const midScore = ((from + to) / 2 + 1) / 2 * 5;
    return { from, to, tone: TONE_OF_SCORE[scoreBand(midScore).tone] };
  });
  return spans.reduce<{ from: number; to: number; tone: GaugeTone }[]>((merged, span) => {
    const last = merged[merged.length - 1];
    if (last && last.tone === span.tone) {
      last.to = span.to;
      return merged;
    }
    return [...merged, span];
  }, []);
}

/** Exported for the dial's own test: proof that the boundaries are derived from `SCORE_BREAKS`
 *  rather than reasserted as separate literals. */
export const SCORE_ZONES = buildScoreZones();

const ZONES: Record<"floor" | "band" | "score", { from: number; to: number; tone: GaugeTone }[]> = {
  floor: FLOOR_ZONES,
  band: BAND_ZONES,
  score: SCORE_ZONES,
};

const TONE_TEXT: Record<GaugeTone, string> = {
  danger: "text-(--danger)",
  warning: "text-(--warning)",
  success: "text-(--success)",
  neutral: "text-(--muted)",
};

export function Dial({
  name, value, reading, zones, onOpen, openLabel,
}: {
  name: string;
  value: string;
  reading: GaugeReading;
  zones: "floor" | "band" | "score";
  onOpen?: () => void;
  openLabel?: string;
}) {
  // The needle reaches the ring's inner edge (RING_INNER, not a second literal) so it points
  // INTO the coloured band it names rather than stopping short of it.
  const [nx, ny] = pointAt(angle(reading.position), RING_INNER);
  const body = (
    <>
      <svg viewBox="0 0 100 56" aria-hidden="true" className="w-full max-w-[9rem]">
        {ZONES[zones].map((z) => (
          <path
            key={`${z.from}`}
            data-zone={z.tone}
            d={ringPath(angle(z.from), angle(z.to), RING_INNER, R)}
            fill={TONE_FILL[z.tone]}
            /* The band a reading is NOT in stays present but quiet: a gauge whose other zones
             * vanish stops being a scale and becomes a bar. */
            opacity={z.tone === reading.tone ? 1 : 0.22}
          />
        ))}
        {/* The needle. No transition: `prefers-reduced-motion` would have to suppress it and a
          * dial that animates on every re-render is motion with no message. */}
        <line x1={CX} y1={CY} x2={nx} y2={ny} stroke="var(--foreground)" strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={CX} cy={CY} r={3} fill="var(--foreground)" />
      </svg>
      <span className="eyebrow">{name}</span>
      <span className="text-2xl font-semibold stat-num">{value}</span>
      <span className={`text-xs ${TONE_TEXT[reading.tone]}`}>{reading.label}</span>
    </>
  );

  const shell = "flex flex-col items-center gap-0.5 rounded-lg border border-(--separator) p-4";

  // A DIAL WITH NOWHERE TO GO IS NOT A BUTTON. Offering the affordance for a gauge whose detail
  // does not exist is a control that does nothing, which is worse than no control.
  // `min-w-0` here lets the card shrink inside its grid cell; there is no target-size rule to
  // satisfy because there is no control.
  if (!onOpen) return <div className={`${shell} min-w-0`}>{body}</div>;

  // The 44px target-size floor (WCAG 2.5.8) is stated explicitly on both axes rather than left to
  // inherit from the SVG's content width, which is what `min-w-0` would have done.
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${name}, ${value}, ${reading.label} — open ${openLabel}`}
      className={`${shell} min-w-[44px] min-h-[44px] text-left hover:border-(--accent) focus-visible:outline-2 focus-visible:outline-(--accent)`}
    >
      {body}
    </button>
  );
}
