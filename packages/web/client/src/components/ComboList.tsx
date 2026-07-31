import type { DeckReport } from "../types.js";

export function ComboList({ combos }: { combos: DeckReport["combos"] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="border-t-2 border-(--accent) pt-2">
        <h2 className="text-2xl leading-none text-(--accent)">Combos</h2>
      </div>
      {combos.length === 0 ? (
        <p className="text-(--muted) text-sm">None found.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {combos.map((c, i) => (
            <li key={i} className="flex items-center gap-3 py-1.5 border-b border-(--separator)">
              <span className="pip shrink-0">{c.cards.length}</span>
              <span className="text-sm">
                <span className="font-semibold">{c.cards.join(" + ")}</span>{" "}
                <span className="text-(--accent) font-mono">⇒</span> {c.result}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
