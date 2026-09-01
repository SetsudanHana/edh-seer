import { TYPE_ORDER } from "../lib/deck-shape.js";
import { TYPE_SEGMENT_HUE } from "./presets.js";
import type { TypeSlice } from "../lib/deck-shape.js";

/** The surface gap between adjacent fills. Never a stroke -- a border is ink that is not data. */
const GAP = 2;

/** WHAT THE DECK IS MADE OF, as part-to-whole.
 *
 *  A BAR AND NOT A RING, and the data decided it. On a real deck the six types run
 *  creature 21, enchantment 19, instant 12, artifact 9, sorcery 5 -- two close pairs. In a donut
 *  21 against 19 is about 11 degrees of arc, which nobody reads; on a shared baseline it is
 *  visible. Part-to-whole with close values is the stacked bar's case, not the pie's.
 *
 *  SEGMENTS RENDER IN `TYPE_ORDER` AND ARE NEVER SORTED. That order is the colour guarantee --
 *  see `TYPE_SEGMENT_HUE`. */
export function TypeBar({ slices }: { slices: readonly TypeSlice[] }) {
  if (slices.length === 0) return null;
  const byType = new Map(slices.map((s) => [s.type, s.count]));
  const ordered = TYPE_ORDER.flatMap((t) => {
    const count = byType.get(t);
    return count ? [{ type: t, count }] : [];
  });
  const total = ordered.reduce((a, s) => a + s.count, 0);

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <p className="flex items-baseline gap-2">
        <span data-testid="type-total" className="text-2xl font-semibold stat-num text-(--foreground)">
          {total}
        </span>
        <span className="text-sm text-(--muted)">nonland cards</span>
      </p>
      <div
        className="flex w-full h-6 rounded-(--radius) overflow-hidden"
        style={{ gap: GAP }}
        role="img"
        aria-label={`Card types: ${ordered.map((s) => `${s.count} ${s.type}`).join(", ")}. ${total} nonland cards.`}
      >
        {ordered.map((s) => (
          <span
            key={s.type}
            data-testid={`type-segment-${s.type}`}
            className="block h-full first:rounded-l-(--radius) last:rounded-r-(--radius)"
            style={{ width: `${(s.count / total) * 100}%`, background: TYPE_SEGMENT_HUE[s.type] }}
          >
            <title>{`${s.count} ${s.type}`}</title>
          </span>
        ))}
      </div>
      {/* The counts in text. On a six-segment bar the two smallest segments are too narrow for an
        *  in-place number, and identity may never rest on colour alone. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {ordered.map((s) => (
          <li key={s.type} data-testid={`type-legend-${s.type}`} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: TYPE_SEGMENT_HUE[s.type] }}
            />
            <span className="text-(--muted)">{s.type}</span>
            <span className="stat-num text-(--foreground)">{s.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
