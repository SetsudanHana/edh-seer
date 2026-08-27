import type { DeckReport } from "../types.js";

export function SuggestionsList({ suggestions }: { suggestions: DeckReport["suggestions"] }) {
  if (!suggestions || suggestions.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Suggestions</h3>
      {/* A SENTENCE KEEPS INTER — "Consistency 6/14 — add ~8, typically 2–4 mana" is prose with
        *  figures in it, and `index.css`'s own `.stat-num` comment reserves mono for a figure.
        *  `tabular-nums` keeps the counts from shifting without making the words monospace. */}
      <ul className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <li key={s} className="text-sm tabular-nums rounded-full border border-(--separator) px-3 py-1 text-(--muted)">{s}</li>
        ))}
      </ul>
    </div>
  );
}
