import type { DeckReport } from "../types.js";

export function ThemeBars({
  themes,
  roles,
}: {
  themes: DeckReport["themes"];
  roles: DeckReport["roles"];
}) {
  const max = Math.max(1, ...themes.map((t) => t.count));
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Themes</h2>
        <div className="flex flex-col gap-1">
          {themes.map((t) => (
            <div key={t.tag} className="flex items-center gap-2 text-sm">
              <span className="w-40 truncate">{t.tag}</span>
              <div className="h-3 bg-primary rounded" style={{ width: `${(t.count / max) * 100}%` }} />
              <span>{t.count}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="text-sm">
        <h2 className="text-lg font-semibold">Roles</h2>
        <span className="mr-4">ramp: {roles.ramp}</span>
        <span className="mr-4">draw: {roles.draw}</span>
        <span>removal: {roles.removal}</span>
      </div>
    </div>
  );
}
