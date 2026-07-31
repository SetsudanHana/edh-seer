import type { DeckReport } from "../types.js";

export function ThemeBars({ themes }: { themes: DeckReport["themes"] }) {
  const max = Math.max(1, ...themes.map((t) => t.count));
  return (
    <div className="flex flex-col gap-3">
      <div className="border-t-2 border-(--accent) pt-2 flex flex-col gap-0.5">
        <h2 className="text-2xl leading-none text-(--accent)">Full theme breakdown</h2>
        <p className="text-xs text-(--muted)">Every tag this deck touches, beyond the primary/secondary above</p>
      </div>
      <div className="flex flex-col gap-2">
        {themes.map((t) => (
          <div key={t.tag} className="flex items-center gap-3 text-sm">
            <span className="w-40 truncate shrink-0">{t.tag}</span>
            <div className="flex-1 h-2 bg-(--separator) rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-(--accent)"
                style={{ width: `${(t.count / max) * 100}%` }}
              />
            </div>
            <span className="font-mono text-xs text-(--muted) w-6 text-right shrink-0">{t.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
