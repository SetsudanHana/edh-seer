import { useEffect, useRef, useState } from "react";
import { scaleBand, scaleLinear } from "d3-scale";

const HEIGHT = 132;
/** Room for the widest tick text either chart renders ("100%", "20") at TICK_FONT. */
const AXIS_W = 36;
const LABEL_H = 18;
/** Room above the tallest bar for the peak callout and the topmost y-tick's text. Without it the
 *  range top is 0, so a peak (or a tick) sitting at the domain max renders its baseline flush with
 *  the viewBox edge and clips the ascenders -- invisible, not just tight. */
const TOP_PAD = 16;
/** Cap the mark and let the band's leftover be air. A bar stretched to fill a 700px-wide band is
 *  a slab, not a mark: at eight buckets the chart stops reading as a distribution and starts
 *  reading as a wall. */
const MAX_BAR = 24;
/** The surface gap that separates adjacent bars. Never a stroke -- a border adds ink that is not
 *  data. Only binds on a narrow container, where the 24px cap has already stopped biting. */
const GAP = 2;
const CORNER = 4;
const TICK_FONT = 11;
const PEAK_FONT = 12;
/** Pre-measure and under jsdom, where a ResizeObserver never fires and every box is 0 wide. */
const FALLBACK_W = 400;
/** Eight buckets do not get wider by being given a 680px column -- the marks stay capped at 24px
 *  and only the air between them grows, until the chart reads as scattered ticks rather than a
 *  distribution. Measured in the browser at both widths before this was fixed at 440. */
const MAX_W = 440;

export interface Bar { label: string; value: number; title: string }

/** A column with a rounded cap and square feet. `rx` on a <rect> rounds all four corners, which
 *  puts a curve where the mark meets its own baseline -- the bar reads as floating. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(CORNER, w / 2, h);
  if (h <= 0) return `M${x},${y}h${w}`;
  return `M${x},${y + h}V${y + r}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${y + h}Z`;
}

/** A categorical bar chart. d3-scale does the arithmetic, React emits the SVG -- d3-selection
 *  is deliberately absent, and so is d3-axis, which can only render by mutating a selection.
 *  Ticks come from scale.ticks() instead.
 *
 *  THE VIEWBOX IS MEASURED IN REAL PIXELS, AND THAT IS THE WHOLE POINT. This drew into a fixed
 *  400-unit box under `preserveAspectRatio="none"`, so a container wider than 400px scaled x and
 *  left y alone -- in an 800px column every glyph was stretched 2x horizontally at its original
 *  height, the 1-unit corner radius became a 2x1 ellipse, and the gaps between bars grew while the
 *  bars did too. Nothing was mis-computed; the whole drawing was being pulled sideways. One unit
 *  is now one pixel, so a font size is a font size and 24px is 24px.
 *
 *  Shared by ManaCurveChart and LandMathChart, which differ only in their labels and formatting. */
export function BarChart({
  heading, bars, formatTick, peakLabel, ariaLabel,
}: {
  /** Rendered as the visible heading. Empty when a caller titles the chart itself -- pass
   *  `ariaLabel` there, or the chart is an image with no accessible name. */
  heading: string;
  bars: readonly Bar[];
  formatTick: (v: number) => string;
  peakLabel: (b: Bar) => string;
  /** The accessible name, when the visible heading is not it. */
  ariaLabel?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_W);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? 0;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plotH = HEIGHT - LABEL_H;
  const x = scaleBand<string>()
    .domain(bars.map((b) => b.label))
    .range([AXIS_W, width]);
  // `|| 1` guards an all-zero dataset: a zero-width domain makes every bar NaN-high.
  const max = Math.max(...bars.map((b) => b.value)) || 1;
  const y = scaleLinear().domain([0, max]).range([plotH, TOP_PAD]).nice();
  const barW = Math.max(2, Math.min(MAX_BAR, x.bandwidth() - GAP));
  // `bars[0]` is undefined for an empty array; reduce then returns that initial value untouched
  // (the callback never runs on an empty array), so `peak` stays undefined rather than throwing.
  const peak = bars.length > 0
    ? bars.reduce((best, b) => (b.value > best.value ? b : best), bars[0])
    : undefined;

  return (
    <div className="flex flex-col gap-2" style={{ maxWidth: MAX_W }} ref={wrap}>
      {heading ? <h3 className="eyebrow">{heading}</h3> : null}
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        style={{ height: HEIGHT, width: "100%" }}
        role="img"
        aria-label={ariaLabel || heading}
      >
        {/* THE SHAPE, IN A SENTENCE. A sighted reader gets the distribution from the picture; a
            screen reader got the accessible name and then eight <title> tooltips reachable only by
            pointer. Built from the bars themselves -- the peak's `title` is already a full sentence
            each caller writes ("19 cards at mana value 3") -- so this restates nothing and cannot
            drift from what is drawn. No table: these values appear as text elsewhere in the report,
            and a duplicate of them is page weight, not access. */}
        <desc>
          {`${bars.length} bars, ${bars[0]?.label ?? ""} to ${bars[bars.length - 1]?.label ?? ""}.`}
          {peak && peak.value > 0 ? ` Highest: ${peak.title}.` : ""}
        </desc>
        {y.ticks(4).map((t) => (
          <g key={t} data-testid="y-tick">
            <line
              x1={AXIS_W} x2={width} y1={y(t)} y2={y(t)}
              stroke="var(--separator)" strokeWidth={1} vectorEffect="non-scaling-stroke"
            />
            <text
              x={AXIS_W - 6} y={y(t)} textAnchor="end" dominantBaseline="middle"
              className="font-mono fill-(--muted)" style={{ fontSize: TICK_FONT }}
            >
              {formatTick(t)}
            </text>
          </g>
        ))}
        {bars.map((b) => {
          const mid = (x(b.label) ?? 0) + x.bandwidth() / 2;
          const h = Math.max(0, plotH - y(b.value));
          return (
            <g key={b.label}>
              {/* `title` as an ATTRIBUTE is what RTL's getByTitle matches (`[title]`); the nested
                  <title> ELEMENT is what the browser shows on hover. A <title> that is not a direct
                  child of the root <svg> matches neither selector, so both are needed and neither
                  creates a second getByTitle match. React's SVG prop types omit `title`, so it is
                  spread in as an untyped prop rather than cast. */}
              <path
                {...{
                  "data-testid": "bar",
                  d: columnPath(mid - barW / 2, y(b.value), barW, h),
                  fill: "var(--accent)", title: b.title,
                }}
              >
                <title>{b.title}</title>
              </path>
              <text
                data-testid="bar-label"
                x={mid} y={HEIGHT - 5} textAnchor="middle"
                className="font-mono fill-(--muted)" style={{ fontSize: TICK_FONT }}
              >
                {b.label}
              </text>
              {b === peak && b.value > 0 ? (
                <text
                  data-testid="peak-label"
                  x={mid} y={y(b.value) - 5} textAnchor="middle"
                  className="font-mono fill-(--foreground)" style={{ fontSize: PEAK_FONT }}
                >
                  {peakLabel(b)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
