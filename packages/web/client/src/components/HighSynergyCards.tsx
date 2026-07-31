import type { DeckReport } from "../types.js";

export function HighSynergyCards({ cards }: { cards: DeckReport["cards"] }) {
  const ranked = cards
    .filter((c) => (c.synergyRating ?? 0) > 0)
    .slice()
    .sort((a, b) => (b.synergyRating ?? 0) - (a.synergyRating ?? 0) || a.name.localeCompare(b.name))
    .slice(0, 8);
  if (ranked.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">High synergy cards</h3>
      <ul className="flex flex-col">
        {ranked.map((c) => (
          <li key={c.name} className="flex items-center gap-3 py-1.5 border-b border-(--separator)">
            <span className="pip shrink-0 tabular-nums">{(c.synergyRating ?? 0).toFixed(1)}</span>
            <span className="flex-1 min-w-0 truncate">{c.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
