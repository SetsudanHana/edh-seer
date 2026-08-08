import { scaleBand, scaleLinear } from "d3-scale";

const HEIGHT = 120;
const AXIS_W = 28;
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
  // A width of 100 with preserveAspectRatio="none" lets the SVG stretch to its container the way
  // the flexbox version did, without measuring the DOM.
  const width = 100;
  const x = scaleBand<string>()
    .domain(bars.map((b) => b.label))
    .range([AXIS_W, width])
    .padding(0.15);
  // `|| 1` guards an all-zero dataset: a zero-width domain makes every bar NaN-high.
  const max = Math.max(...bars.map((b) => b.value)) || 1;
  const y = scaleLinear().domain([0, max]).range([plotH, 0]).nice();
  const peak = bars.reduce((best, b) => (b.value > best.value ? b : best), bars[0]);
  const peakText = peak.value > 0 ? peakLabel(peak) : null;
  // Mana-value bar labels ("0".."7") and card-count y-ticks share the same small-integer range, so
  // a tick can coincide textually with an x-axis label or the peak's own callout (e.g. peak count
  // 8 on an 8-bar axis 0..7). Rather than show the same string twice -- which reads as if the tick
  // points at that one bar -- keep the gridline but drop the redundant number.
  const barLabels = new Set(bars.map((b) => b.label));

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
        {y.ticks(4).map((t) => {
          const text = formatTick(t);
          const showText = text !== peakText && !barLabels.has(text);
          return (
            <g key={t} data-testid="y-tick">
              <line
                x1={AXIS_W} x2={width} y1={y(t)} y2={y(t)}
                stroke="var(--separator)" strokeWidth={0.5} vectorEffect="non-scaling-stroke"
              />
              {showText ? (
                <text
                  x={AXIS_W - 3} y={y(t)} textAnchor="end" dominantBaseline="middle"
                  className="font-mono fill-(--muted)" style={{ fontSize: 7 }}
                >
                  {text}
                </text>
              ) : null}
            </g>
          );
        })}
        {bars.map((b) => (
          <g key={b.label}>
            {/* `title` as an attribute, not a nested <title> element: RTL's getByTitle matches
                `[title]` or `svg > title` (a title that's a direct child of the root <svg>) --
                never a <title> nested inside a shape. The attribute also gets the native hover
                tooltip. React's SVG prop types omit `title` even though browsers support it, so
                it's spread in as an untyped prop rather than cast with `as any`. */}
            <rect
              {...{
                x: x(b.label), width: x.bandwidth(),
                y: y(b.value), height: Math.max(0, plotH - y(b.value)),
                rx: 1, fill: "var(--accent)", title: b.title,
              }}
            />
            <text
              x={(x(b.label) ?? 0) + x.bandwidth() / 2} y={HEIGHT - 4} textAnchor="middle"
              className="font-mono fill-(--muted)" style={{ fontSize: 7 }}
            >
              {b.label}
            </text>
            {b === peak && b.value > 0 ? (
              <text
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
