import type { DeckReport } from "../types.js";
import { CardName } from "./card-drawer.js";

function ArrowIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function ComboList({ combos }: { combos: DeckReport["combos"] }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="eyebrow">Combos</h3>
      {combos.length === 0 ? (
        <p className="text-(--muted) text-sm">None found.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {combos.map((c, i) => (
            <li key={i} className="flex items-center gap-3 py-1.5 border-b border-(--separator)">
              <span className="pip shrink-0 tabular-nums">{c.cards.length}</span>
              <span className="text-sm flex items-center gap-2 flex-wrap">
                {/* Each piece opens its own inspector: "these three go infinite" is only
                    actionable once you can ask what each one is doing. */}
                <span className="font-semibold flex flex-wrap items-baseline gap-1">
                  {c.cards.map((name, k) => (
                    <span key={name}>
                      {k > 0 ? <span className="text-(--muted) font-normal"> + </span> : null}
                      <CardName name={name} />
                    </span>
                  ))}
                </span>
                <span className="text-(--accent)">
                  <ArrowIcon />
                </span>
                {c.result}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
