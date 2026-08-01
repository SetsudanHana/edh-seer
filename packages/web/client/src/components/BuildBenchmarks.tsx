import type { DeckReport } from "../types.js";

const LABEL: Record<string, string> = {
  ramp: "Ramp", draw: "Draw", cardSelection: "Card selection", targetedRemoval: "Removal",
  stackInteraction: "Stack interaction", boardWipe: "Board wipes", burn: "Burn & drain", stax: "Stax",
  protection: "Protection", tutor: "Tutors", lands: "Lands",
};
const LAND_BAND = 3; // lands are two-sided: satisfied within ±3 of target.

export function BuildBenchmarks({ categories }: { categories: DeckReport["buildCategories"] }) {
  if (!categories || categories.length === 0) return null;
  const rows = categories.filter((c) => c.target > 0); // zero-target = neutral, omitted (mirrors engine)
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Build benchmarks</h3>
      <ul className="flex flex-col gap-1.5">
        {rows.map((c) => {
          const name = LABEL[c.category] ?? c.category;
          const under = c.category === "lands" ? c.count < c.target - LAND_BAND : c.count < c.target;
          const over = c.category === "lands" && c.count > c.target + LAND_BAND;
          const flagged = under || over;
          const state = under ? "under target" : over ? "over target" : "on target";
          const fill = Math.max(0, Math.min(1, c.count / c.target));
          return (
            <li key={c.category} className="flex items-center gap-3" aria-label={`${name} ${c.count} of ${c.target}, ${state}`}>
              <span className="w-24 shrink-0 text-sm">{name}</span>
              <span className="flex-1 h-2 rounded-full bg-(--separator) overflow-hidden">
                <span
                  className={`block h-full rounded-full ${flagged ? "bg-(--warning)" : "bg-(--success)"}`}
                  style={{ width: `${fill * 100}%` }}
                />
              </span>
              <span className="w-14 shrink-0 text-right text-sm tabular-nums">{c.count}/{c.target}</span>
              <span className={`w-4 shrink-0 text-sm ${flagged ? "text-(--warning)" : "text-(--success)"}`} aria-hidden>{flagged ? "▲" : "✓"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
