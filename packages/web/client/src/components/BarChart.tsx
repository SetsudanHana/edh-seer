import { scaleBand, scaleLinear } from "d3-scale";

const HEIGHT = 120;
// AXIS_W is an x-coordinate in the same 400-unit space as `width` below, sized for the widest
// tick text either chart renders ("100%", "20") at fontSize 7 -- not a fraction carried over from
// a different viewBox width.
const AXIS_W = 32;
const LABEL_H = 16;

export interface Bar { label: string; value: number; title: string }

/** A categorical bar chart. d3-scale does the arithmetic, React emits the SVG -- d3-selection
 *  is deliberately absent, and so is d3-axis, which can only render by mutating a selection.
 *  Ticks come from scale.ticks() instead.
 *
 *  Shared by ManaCurveChart and LandMathChart, which differ only in their labels and formatting. */
export function BarChart({
  heading, bars, formatTick, peakLabel,
}: {
  heading: string;
  bars: readonly Bar[];
  formatTick: (v: number) => string;
  peakLabel: (b: Bar) => string;
}) {
  const plotH = HEIGHT - LABEL_H;
  // 400 is a realistic rendered chart width (containers run ~300-600px), so with
  // preserveAspectRatio="none" the horizontal scale factor (containerPx / 400) lands near 1x
  // instead of the 3-6x stretch a width of 100 produced at those container sizes.
  const width = 400;
  const x = scaleBand<string>()
    .domain(bars.map((b) => b.label))
    .range([AXIS_W, width])
    .padding(0.15);
  // `|| 1` guards an all-zero dataset: a zero-width domain makes every bar NaN-high.
  const max = Math.max(...bars.map((b) => b.value)) || 1;
  const y = scaleLinear().domain([0, max]).range([plotH, 0]).nice();
  // `bars[0]` is undefined for an empty array; reduce then returns that initial value untouched
  // (the callback never runs on an empty array), so `peak` stays undefined rather than throwing.
  const peak = bars.length > 0
    ? bars.reduce((best, b) => (b.value > best.value ? b : best), bars[0])
    : undefined;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">{heading}</h3>
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        preserveAspectRatio="none"
        style={{ height: HEIGHT, width: "100%" }}
        role="img"
        aria-label={heading}
      >
        {y.ticks(4).map((t) => (
          <g key={t} data-testid="y-tick">
            <line
              x1={AXIS_W} x2={width} y1={y(t)} y2={y(t)}
              stroke="var(--separator)" strokeWidth={0.5} vectorEffect="non-scaling-stroke"
            />
            <text
              x={AXIS_W - 3} y={y(t)} textAnchor="end" dominantBaseline="middle"
              className="font-mono fill-(--muted)" style={{ fontSize: 7 }}
            >
              {formatTick(t)}
            </text>
          </g>
        ))}
        {bars.map((b) => (
          <g key={b.label}>
            {/* `title` on the <rect> as an attribute gets the real browser hover tooltip and is
                what RTL's getByTitle matches (`[title]`). A bare `<title>` *element* nested inside
                a shape matches neither `[title]` nor `svg > title` (getByTitle only recognizes a
                <title> that is a direct child of the root <svg>), so it's added purely for the
                tooltip and doesn't create a second getByTitle match. React's SVG prop types omit
                `title` even though browsers support it, so it's spread in as an untyped prop
                rather than cast with `as any`. */}
            <rect
              {...{
                x: x(b.label), width: x.bandwidth(),
                y: y(b.value), height: Math.max(0, plotH - y(b.value)),
                rx: 1, fill: "var(--accent)", title: b.title,
              }}
            >
              <title>{b.title}</title>
            </rect>
            <text
              data-testid="bar-label"
              x={(x(b.label) ?? 0) + x.bandwidth() / 2} y={HEIGHT - 4} textAnchor="middle"
              className="font-mono fill-(--muted)" style={{ fontSize: 7 }}
            >
              {b.label}
            </text>
            {b === peak && b.value > 0 ? (
              <text
                data-testid="peak-label"
                x={(x(b.label) ?? 0) + x.bandwidth() / 2} y={y(b.value) - 3} textAnchor="middle"
                className="font-mono fill-(--foreground)" style={{ fontSize: 7 }}
              >
                {peakLabel(b)}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}
