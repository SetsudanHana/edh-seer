/** THE MAP'S COLOUR KEY, ONE COMPONENT FOR EVERY MAP (designer crawl 2026-10-03, #993).
 *
 *  The same coloured-edge commander map had three keys: a vertical list with counts in the report's
 *  Glance rail, a row of pill chips with no counts on the commander page, and nothing at all on the
 *  precon page (#890). The report's form is the one kept, because it carries the counts: a colour's
 *  name, and under it how many of the map's cards it covers.
 *
 *  `columns` lays the same rows out across the width under a map that spans the page; the Glance
 *  rail stacks them. A row with `onPick` is a button (the Glance opens that group's panel); without
 *  it, a plain line. */
export interface MapKeyRow {
  key: string;
  name: string;
  hue: string;
  /** Under the name, e.g. "17 with Inalla, 1 of them only once". */
  count?: string;
  onPick?: () => void;
}

export function MapKey({ rows, columns = false, label = "What the colours are" }: {
  rows: MapKeyRow[]; columns?: boolean; label?: string;
}) {
  if (!rows.length) return null;
  return (
    <ul aria-label={label} className={columns ? "grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-x-4 gap-y-1" : "flex flex-col gap-1"}>
      {rows.map((r) => {
        // THE COUNT UNDER ITS NAME (designer review 2026-09-29): beside it, a long group name
        // wrapped to two lines and "Other links" squeezed the count.
        const body = (
          <>
            <span aria-hidden="true" className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ background: r.hue }} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span>{r.name}</span>
              {r.count ? <span className="text-xs text-(--muted)">{r.count}</span> : null}
            </span>
          </>
        );
        return (
          <li key={r.key}>
            {r.onPick
              ? <button type="button" className="flex min-h-11 w-full items-start gap-2 rounded-(--radius) px-1 py-1 text-left hover:bg-(--surface-secondary)" onClick={r.onPick}>{body}</button>
              : <span className="flex items-start gap-2 px-1 py-1">{body}</span>}
          </li>
        );
      })}
    </ul>
  );
}
