import type { DeckReport } from "../types.js";

export function DeckIdentity({ cohesion }: { cohesion: DeckReport["cohesion"] }) {
  if (!cohesion) return null;
  return (
    <div className="border border-(--border) rounded-(--radius) p-5 bg-(--surface) flex flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <span className="eyebrow shrink-0">Deck identity</span>
        <h2 className="text-2xl font-bold leading-none text-(--accent) capitalize">{cohesion.theme}</h2>
      </div>
      <p className="text-sm text-(--muted)">
        {cohesion.label} —{" "}
        <span className="font-mono tabular-nums text-(--foreground)">{Math.round(cohesion.score * 100)}%</span> of
        nonland cards
        {cohesion.secondary ? (
          <>
            {" "}
            · secondary theme: <span className="text-(--foreground) capitalize">{cohesion.secondary}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
