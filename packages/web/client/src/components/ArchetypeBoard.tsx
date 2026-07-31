import { useState } from "react";
import type { DeckReport } from "../types.js";

type Group = NonNullable<DeckReport["archetypes"]>[number];

function ArchetypeGroupRow({ group, max }: { group: Group; max: number }) {
  const [open, setOpen] = useState(false);
  const widthPct = Math.max(4, Math.round((group.cards.length / max) * 100));
  return (
    <div className="flex flex-col gap-1 py-2 border-b border-(--separator)">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-3 text-left w-full"
        aria-expanded={open}
      >
        <span className="w-40 shrink-0 truncate">{group.label}</span>
        <div className="flex-1 h-2 bg-(--separator) rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-(--accent)" style={{ width: `${widthPct}%` }} />
        </div>
        <span className="font-mono text-xs text-(--muted) w-20 text-right shrink-0">
          {group.cards.length} card{group.cards.length === 1 ? "" : "s"}
        </span>
      </button>
      {open ? (
        <ul className="flex flex-col gap-2 pl-4 pt-1">
          {group.pairs.map((pair, i) => (
            <li key={`${pair.a}-${pair.b}-${i}`} className="text-sm">
              <span className="font-semibold">
                {pair.a} + {pair.b}
              </span>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {pair.reasons.map((r, j) => (
                  <li key={j} className="text-(--muted) border-l border-(--separator) pl-2">
                    {r.text}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ArchetypeBoard({ archetypes }: { archetypes: DeckReport["archetypes"] }) {
  if (!archetypes || archetypes.length === 0) {
    return (
      <p className="text-(--muted) text-sm">
        No recognizable archetype patterns — try adding more synergy pieces.
      </p>
    );
  }
  const max = Math.max(1, ...archetypes.map((g) => g.cards.length));
  return (
    <div className="flex flex-col">
      {archetypes.map((g) => (
        <ArchetypeGroupRow key={g.category} group={g} max={max} />
      ))}
    </div>
  );
}
