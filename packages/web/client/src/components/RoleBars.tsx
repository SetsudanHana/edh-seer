import type { RoleBar } from "../lib/deck-shape.js";

/** WHAT THE DECK'S CARDS DO, as magnitude.
 *
 *  BARS AND NOT A PART-TO-WHOLE CHART, because roles do not partition the deck: a card can carry
 *  REMOVAL and DRAW both, and the sub-role shares are shares OF a parent rather than of the deck.
 *  (Written as "not a second donut" when `TypeBar` beside it was a ring; the ring is now a stacked
 *  bar, and the distinction that matters was never the FORM but the claim — a stacked bar asserts a
 *  whole just as a pie does, and here there is no whole to assert.) A bar claims magnitude only, so
 *  overlap is honest.
 *
 *  ONE HUE, not five. These four are one measure at four points, not four identities -- a
 *  categorical palette here would imply a difference in kind that is not in the data. Length
 *  carries the comparison; colour carries nothing and so should not vary. */
export function RoleBars({ bars }: { bars: readonly RoleBar[] }) {
  if (bars.length === 0) return null;
  const max = Math.max(...bars.map((b) => b.count)) || 1;
  return (
    <ul className="flex flex-col gap-2 min-w-0 flex-1">
      {bars.map((b) => (
        <li key={b.role} data-testid={`role-row-${b.role}`} className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 text-(--muted) truncate">{b.role}</span>
          <span className="flex-1 min-w-0 h-2 rounded-(--radius) bg-(--surface-secondary)">
            <span
              data-testid={`role-bar-${b.role}`}
              className="block h-full rounded-(--radius) bg-(--fill)"
              style={{ width: `${(b.count / max) * 100}%` }}
            />
          </span>
          <span className="w-8 shrink-0 text-right stat-num text-(--foreground)">{b.count}</span>
        </li>
      ))}
    </ul>
  );
}
