import type { DeckReport } from "../types.js";

export function SuggestionsList({ suggestions }: { suggestions: DeckReport["suggestions"] }) {
  if (!suggestions || suggestions.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Suggestions</h3>
      <ul className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <li key={s} className="text-sm stat-num rounded-full border border-(--separator) px-3 py-1 text-(--muted)">{s}</li>
        ))}
      </ul>
    </div>
  );
}
