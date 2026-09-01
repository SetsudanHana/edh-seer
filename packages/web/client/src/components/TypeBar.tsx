import { TYPE_ORDER } from "../lib/deck-shape.js";
import { TYPE_SEGMENT_HUE, segmentInk } from "./presets.js";
import type { TypeSlice } from "../lib/deck-shape.js";

/** The surface gap between adjacent fills. Never a stroke -- a border is ink that is not data. */
const GAP = 2;

/** How wide a segment has to be, as a share of the bar, before its count is printed INSIDE it.
 *
 *  WHY A THRESHOLD EXISTS AT ALL: a segment is sized by its own value, so the label and the space
 *  available for it move in opposite directions from the same number. Below some width the digits
 *  either spill across the gap onto the NEIGHBOURING fill -- where their contrast is a different
 *  measurement entirely, and may be one of the failing ones -- or get clipped mid-digit, and a
 *  half-visible "1" of "12" is worse than no label. 8% is where a two-digit `text-xs` number plus
 *  its padding (~26px) still fits the narrowest track this panel renders on: a 390px viewport
 *  leaves the bar about 330px after gutters. Segments under it are named by the legend only.
 *
 *  IT IS A FLOOR ON WIDTH, NOT A CHOICE ABOUT IMPORTANCE. A 3% segment is not less worth labelling;
 *  there is simply nowhere to put the label. */
const IN_PLACE_LABEL_MIN_SHARE = 0.08;

/** WHAT THE DECK IS MADE OF, as part-to-whole.
 *
 *  A BAR AND NOT A RING, and the data decided it. On a real deck the six types run
 *  creature 21, enchantment 19, instant 12, artifact 9, sorcery 5 -- two close pairs. In a donut
 *  21 against 19 is about 11 degrees of arc, which nobody reads; on a shared baseline it is
 *  visible. Part-to-whole with close values is the stacked bar's case, not the pie's.
 *
 *  SEGMENTS RENDER IN `TYPE_ORDER` AND ARE NEVER SORTED. That order is the colour guarantee --
 *  see `TYPE_SEGMENT_HUE`. */
export function TypeBar({ slices, lands }: { slices: readonly TypeSlice[]; lands?: number }) {
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
        {/* A COUNT, NOT A VERDICT. Whether 38 is the right number for this curve is the lands dial in
          *  `DeckGauges`; this panel describes. Lands are deliberately not a SLICE -- see
          *  `primaryType`, which excludes them because at ~38% of the deck they would drown the
          *  composition question the bar exists to answer. */}
        {lands !== undefined ? (
          <>
            {" · "}
            <span className="stat-num text-(--foreground)">{lands}</span>{" lands"}
          </>
        ) : null}
      </p>
      <div
        className="flex w-full h-6 rounded-(--radius) overflow-hidden"
        style={{ gap: GAP }}
        role="img"
        aria-label={`Card types: ${ordered.map((s) => `${s.count} ${s.type}`).join(", ")}. ${total} nonland cards.`}
      >
        {/* DIRECT IN-PLACE LABELS, which design §4 makes a REQUIREMENT and not a nicety (I5,
          *  whole-branch review, 2026-09-01). The palette's own stated limit is that enchantment
          *  #1c8db7 and sorcery #3d7ed6 sit at dE 12.5 in normal vision, below the separation floor;
          *  the segment ORDER protects them inside the bar by never placing them adjacent, but a
          *  legend undoes that protection — it asks the reader to match a 10px swatch back to a
          *  segment by hue, which is precisely the judgement those two hues cannot support. A number
          *  printed on the segment itself needs no match. */}
        {ordered.map((s) => {
          const fill = TYPE_SEGMENT_HUE[s.type]!;
          // Both conditions are hard gates, for different reasons: too narrow and the digits
          // overflow onto a neighbouring fill, no legible ink and they are unreadable where they
          // land. Either way the legend below is still carrying this segment.
          const ink = s.count / total >= IN_PLACE_LABEL_MIN_SHARE ? segmentInk(fill) : null;
          return (
            <span
              key={s.type}
              data-testid={`type-segment-${s.type}`}
              className="flex h-full items-center justify-center overflow-hidden first:rounded-l-(--radius) last:rounded-r-(--radius)"
              style={{ width: `${(s.count / total) * 100}%`, background: fill }}
            >
              {/* `aria-hidden`, because the bar's own `aria-label` already reads every count in
                *  order. Two announcements of the same figure is the defect this panel's siblings
                *  keep being fixed for. */}
              {ink ? (
                <span aria-hidden className="stat-num text-xs leading-none" style={{ color: ink }}>
                  {s.count}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
      {/* THE LEGEND STAYS COMPLETE, including the segments that now carry their own count. It is
        *  what NAMES each type: the in-place label is a bare number, so dropping a wide segment's
        *  legend row would leave its identity resting on colour alone — the one thing the
        *  accessibility floor here forbids. The two encodings answer different questions ("which
        *  type is this band" against "how many"), so both earn their place. */}
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
