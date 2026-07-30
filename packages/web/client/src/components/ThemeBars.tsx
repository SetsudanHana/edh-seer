import type { DeckReport } from "../types.js";

export function ThemeBars({ themes }: { themes: DeckReport["themes"] }) {
  const max = Math.max(1, ...themes.map((t) => t.count));
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold">Themes</h2>
      {themes.map((t) => (
        <div key={t.tag} className="flex items-center gap-2 text-sm">
          <span className="w-40 truncate">{t.tag}</span>
          <div className="h-3 bg-primary rounded" style={{ width: `${(t.count / max) * 100}%` }} />
          <span>{t.count}</span>
        </div>
      ))}
    </div>
  );
}
