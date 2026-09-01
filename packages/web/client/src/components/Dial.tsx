import { scaleLinear } from "d3-scale";
import type { GaugeReading, GaugeTone } from "../lib/deck-gauge.js";

/** ONE SEMICIRCLE, drawn from trig rather than from `d3-shape`.
 *
 *  The repo's standing rule is to reuse d3 for anything visualising data, and the value-to-angle
 *  map below is `d3-scale`, which is already a dependency. `d3-shape` is NOT, and adding a package
 *  to emit six lines of arc path for one fixed geometry buys nothing -- there is no stacking, no
 *  layout, no interpolation here, only a constant-radius sweep. */
const R = 46;
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
 *  They mirror `deck-gauge.ts`'s buckets exactly and carry no thresholds of their own -- the module
 *  owns every number, this owns only how wide each band is drawn. `floor` is asymmetric because the
 *  measurement is (see `floorState`); `band` is symmetric because lands genuinely are; `score` is
 *  one-directional because 5 is a ceiling and there is no over side to draw. */
const ZONES: Record<"floor" | "band" | "score", { from: number; to: number; tone: GaugeTone }[]> = {
  floor: [
    { from: -1, to: -0.6, tone: "danger" },
    { from: -0.6, to: -0.2, tone: "warning" },
    { from: -0.2, to: 0.4, tone: "success" },
    { from: 0.4, to: 1, tone: "neutral" },
  ],
  band: [
    { from: -1, to: -0.6, tone: "danger" },
    { from: -0.6, to: -0.2, tone: "warning" },
    { from: -0.2, to: 0.2, tone: "success" },
    { from: 0.2, to: 0.6, tone: "warning" },
    { from: 0.6, to: 1, tone: "danger" },
  ],
  score: [
    { from: -1, to: -0.4, tone: "danger" },
    { from: -0.4, to: 0.2, tone: "warning" },
    { from: 0.2, to: 0.6, tone: "success" },
    { from: 0.6, to: 1, tone: "success" },
  ],
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
  const [nx, ny] = pointAt(angle(reading.position), R - 12);
  const body = (
    <>
      <svg viewBox="0 0 100 56" aria-hidden="true" className="w-full max-w-[9rem]">
        {ZONES[zones].map((z) => (
          <path
            key={`${z.from}`}
            data-zone={z.tone}
            d={ringPath(angle(z.from), angle(z.to), R - 9, R)}
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

  const shell = "flex flex-col items-center gap-0.5 min-w-0 rounded-lg border border-(--separator) p-4";

  // A DIAL WITH NOWHERE TO GO IS NOT A BUTTON. Offering the affordance for a gauge whose detail
  // does not exist is a control that does nothing, which is worse than no control.
  if (!onOpen) return <div className={shell}>{body}</div>;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${name}, ${value}, ${reading.label} — open ${openLabel}`}
      className={`${shell} min-h-[44px] text-left hover:border-(--accent) focus-visible:outline-2 focus-visible:outline-(--accent)`}
    >
      {body}
    </button>
  );
}
