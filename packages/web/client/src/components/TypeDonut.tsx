import { DONUT_HUE } from "./presets.js";
import type { TypeSlice } from "../lib/deck-shape.js";

const SIZE = 168;
const THICKNESS = 26;
/** The surface gap between adjacent fills, in radians. Never a stroke: a border is ink that is
 *  not data. */
const PAD = 0.02;

/** A point on a circle, measured from 12 o'clock clockwise, in the SVG's y-down space. */
function point(r: number, a: number): [number, number] {
  return [r * Math.sin(a), -r * Math.cos(a)];
}

/** ONE DONUT SEGMENT, WRITTEN OUT RATHER THAN IMPORTED. `d3-shape` is not a dependency of this
 *  repo and is not worth becoming one for this: `BarChart.tsx` hand-writes `columnPath()` for the
 *  same reason, and an annulus segment is two arcs and two lines. d3-scale still does arithmetic
 *  wherever there is arithmetic to do -- this is geometry, which is not the same thing. */
function arcPath(a0: number, a1: number, ri: number, ro: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [ox0, oy0] = point(ro, a0);
  const [ox1, oy1] = point(ro, a1);
  const [ix1, iy1] = point(ri, a1);
  const [ix0, iy0] = point(ri, a0);
  return [
    `M${ox0},${oy0}`,
    `A${ro},${ro} 0 ${large} 1 ${ox1},${oy1}`,
    `L${ix1},${iy1}`,
    `A${ri},${ri} 0 ${large} 0 ${ix0},${iy0}`,
    "Z",
  ].join("");
}

/** WHAT THE DECK IS MADE OF, as part-to-whole.
 *
 *  The arc geometry is computed here and React emits it -- d3-selection is deliberately absent,
 *  the same division `BarChart.tsx` sets.
 *
 *  THE TOTAL IS PRINTED IN THE HOLE and that is not decoration: a donut's claim is part-to-whole,
 *  and a reader who cannot see the whole cannot check any part. It also states the denominator
 *  this chart uses, which is NONLAND cards -- without it a reader counts against 100 and finds
 *  the chart wrong. */
export function TypeDonut({ slices }: { slices: readonly TypeSlice[] }) {
  if (slices.length === 0) return null;
  const total = slices.reduce((a, s) => a + s.count, 0);
  const ro = SIZE / 2;
  const ri = SIZE / 2 - THICKNESS;
  // Lay the slices out clockwise from 12 o'clock, each shortened by PAD so adjacent fills are
  // separated by surface rather than by a stroke.
  let cursor = 0;
  const arcs = slices.map((s) => {
    const sweep = (s.count / total) * Math.PI * 2;
    const a0 = cursor + PAD / 2;
    const a1 = cursor + sweep - PAD / 2;
    cursor += sweep;
    return { slice: s, d: arcPath(a0, Math.max(a0, a1), ri, ro) };
  });

  return (
    <div className="flex items-center gap-5 flex-wrap">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ width: SIZE, height: SIZE }}
        role="img"
        aria-label={`Card types: ${slices.map((s) => `${s.count} ${s.type}`).join(", ")}. ${total} nonland cards.`}
      >
        <g transform={`translate(${SIZE / 2},${SIZE / 2})`}>
          {arcs.map(({ slice, d }) => (
            <path
              key={slice.type}
              data-testid="donut-arc"
              d={d}
              fill={DONUT_HUE[slice.type] ?? "var(--muted)"}
            >
              <title>{`${slice.count} ${slice.type}`}</title>
            </path>
          ))}
        </g>
        {/* Text wears text tokens, never a series colour. */}
        <text
          data-testid="donut-total"
          x={SIZE / 2} y={SIZE / 2 - 4} textAnchor="middle"
          className="font-mono fill-(--foreground)" style={{ fontSize: 22 }}
        >
          {total}
        </text>
        <text
          x={SIZE / 2} y={SIZE / 2 + 14} textAnchor="middle"
          className="font-mono fill-(--muted)" style={{ fontSize: 10 }}
        >
          nonland
        </text>
      </svg>
      <ul className="flex flex-col gap-1 text-sm">
        {slices.map((s) => (
          <li key={s.type} data-testid={`donut-legend-${s.type}`} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: DONUT_HUE[s.type] ?? "var(--muted)" }}
            />
            <span className="text-(--muted)">{s.type}</span>
            <span className="stat-num text-(--foreground)">{s.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
