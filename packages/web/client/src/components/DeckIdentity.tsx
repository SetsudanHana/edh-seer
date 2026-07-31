import type { DeckReport } from "../types.js";
import { identityGradient, identityLabel } from "../lib/color-identity.js";

export function DeckIdentity({
  cohesion,
  colorIdentity,
}: {
  cohesion: DeckReport["cohesion"];
  colorIdentity?: string[];
}) {
  if (!cohesion) return null;
  return (
    <div className="border border-(--border) rounded-(--radius) p-5 bg-(--surface) flex flex-col gap-2">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="eyebrow shrink-0">Deck identity</span>
        <h2 className="text-2xl font-bold leading-none text-(--accent) capitalize">{cohesion.theme}</h2>
        {colorIdentity ? (
          <span className="flex items-center gap-1.5 ml-auto">
            <span
              aria-hidden="true"
              className="w-5 h-3 rounded-[3px]"
              style={{ background: identityGradient(colorIdentity) }}
            />
            <span className="text-xs text-(--muted) font-mono">{identityLabel(colorIdentity)}</span>
          </span>
        ) : null}
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
