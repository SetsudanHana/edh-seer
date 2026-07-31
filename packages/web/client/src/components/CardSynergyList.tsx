import type { DeckReport } from "../types.js";

export function CardSynergyList({
  cards,
  commanders,
}: {
  cards: DeckReport["cards"];
  commanders: string[];
}) {
  if (cards.length === 0) return <p className="text-(--muted)">No cards to analyze.</p>;
  const uniqueCommanders = [...new Set(commanders)];
  return (
    <div className="flex flex-col gap-3">
      <div className="border-t-2 border-(--bucket-synergy) pt-2 flex flex-col gap-0.5">
        <h2 className="text-2xl leading-none text-(--bucket-synergy)">
          Synergy{uniqueCommanders.length ? ` — ${uniqueCommanders.join(", ")}` : ""}
        </h2>
        <p className="text-xs text-(--muted)">How each card pulls its weight with the rest of the deck</p>
      </div>
      <ul className="flex flex-col gap-4">
        {cards.map((c) => {
          const plural = c.partnerCount === 1 ? "" : "s";
          return (
            <li key={c.name} className="flex gap-3">
              <span className="pip shrink-0" style={{ ["--pip-color" as string]: "var(--bucket-synergy)" }}>
                {c.score.toFixed(2)}
              </span>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-semibold">{c.name}</span>
                  {c.isCommander ? <span className="eyebrow text-(--accent)">Commander</span> : null}
                  <span className="text-sm text-(--muted)">
                    synergizes with {c.partnerCount} card{plural}
                  </span>
                </div>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {c.topPartners.map((p) =>
                    p.reasons.map((r, j) => (
                      <li
                        key={`${p.name}-${j}`}
                        className="text-sm text-(--muted) border-l border-(--separator) pl-2"
                      >
                        <span className="text-(--foreground)">{p.name}</span>: {r.text}
                      </li>
                    )),
                  )}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
