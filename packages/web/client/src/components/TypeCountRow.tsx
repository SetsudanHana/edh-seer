import { useId, useState } from "react";
import { TYPE_COUNTS, type EventQuery } from "../lib/facets.js";
import { RangeRow } from "./RangeRow.js";

/** HOW MANY TYPES A CARD HAS (#1782). One filter row holding any of five counts, each a RangeRow: a select adds a
 *  count, and a count with a bound is part of the question (the URL), so it stays after a reload. A count added and
 *  not yet bounded has no param, which is what the local list remembers. */
const BOUND_LIMIT: Record<string, number> = { cardtypes: 6, fronttypes: 6, supertypes: 3, subtypes: 12, creaturetypes: 12 };

export function TypeCountRow(
  { query, onChange }: { query: EventQuery; onChange: (next: EventQuery) => void },
): React.JSX.Element {
  const id = useId();
  const asked = TYPE_COUNTS.filter((c) => query[c.min] !== undefined || query[c.max] !== undefined).map((c) => c.sort);
  const [added, setAdded] = useState<string[]>([]);
  const shown = TYPE_COUNTS.filter((c) => asked.includes(c.sort) || added.includes(c.sort));
  const offered = TYPE_COUNTS.filter((c) => !shown.includes(c));
  return (
    <div className="flex flex-col gap-3">
      <span className="eyebrow" id={`${id}-label`}>Number of types</span>
      {shown.map((c) => {
        const min = query[c.min]; const max = query[c.max];
        return (
          <RangeRow
            key={c.sort}
            label={c.label}
            min={min} max={max}
            ceiling={Math.max(BOUND_LIMIT[c.sort] ?? 12, min ?? 0, max ?? 0)}
            onChange={(r) => onChange({ ...query, [c.min]: r.min, [c.max]: r.max })}
          />
        );
      })}
      {offered.length > 0 && (
        <select
          className="field w-56"
          aria-label="Add a count"
          value=""
          onChange={(e) => { if (e.target.value) setAdded((a) => [...a, e.target.value]); }}
        >
          <option value="">{shown.length === 0 ? "Pick what to count…" : "Count something else…"}</option>
          {offered.map((c) => <option key={c.sort} value={c.sort}>{c.label}</option>)}
        </select>
      )}
    </div>
  );
}
