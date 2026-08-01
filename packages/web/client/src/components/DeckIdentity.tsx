import type { DeckReport } from "../types.js";
import { identityGradient, identityLabel } from "../lib/color-identity.js";

export function DeckIdentity({
  cohesion,
  colorIdentity,
  strategies,
}: {
  cohesion: DeckReport["cohesion"];
  colorIdentity?: string[];
  strategies?: DeckReport["strategies"];
}) {
  if (!cohesion) return null;
  const primary = strategies && strategies.length > 0 ? strategies[0].label : null;
  const headline = primary ?? cohesion.theme;
  return (
    <div className="border border-(--border) rounded-(--radius) p-5 bg-(--surface) flex flex-col gap-2">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="eyebrow shrink-0">Deck identity</span>
        <h2 className="text-2xl font-bold leading-none text-(--accent) capitalize">{headline}</h2>
        {colorIdentity && colorIdentity.length > 0 ? (
          // Only shown when the deck actually has a color identity (a resolved
          // commander). A deck with no commander reports [] here — showing a
          // "Colorless" swatch for a deck full of colored cards is misleading, so
          // suppress it rather than claim the deck is colorless.
          <span className="flex items-center gap-1.5 ml-auto">
            <span
              aria-hidden="true"
              className="w-10 h-5 rounded-[4px] border border-(--border)"
              style={{ background: identityGradient(colorIdentity) }}
            />
            <span className="text-xs text-(--muted) font-mono">{identityLabel(colorIdentity)}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
