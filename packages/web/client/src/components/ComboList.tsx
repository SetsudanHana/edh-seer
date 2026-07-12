import type { DeckReport } from "../types.js";

export function ComboList({ combos }: { combos: DeckReport["combos"] }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Combos</h2>
      {combos.length === 0 ? (
        <p className="text-default-500">None found.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {combos.map((c, i) => (
            <li key={i} className="text-sm">
              <span className="font-medium">{c.cards.join(" + ")}</span> ⇒ {c.result}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
