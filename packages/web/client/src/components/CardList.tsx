import { useState } from "react";
import type { CSSProperties } from "react";
import type { DeckReport } from "../types.js";

type Category =
  | "ramp" | "draw" | "cardSelection" | "targetedRemoval" | "stackInteraction"
  | "boardWipe" | "burn" | "stax" | "protection" | "tutor" | "lands";

// Exported: GraphView reuses these for zone labels and the glyph legend, so the graph's
// functional-role names/order stay the same one place as the Cards tab's own filter chips.
export const CATEGORY_LABELS: Record<Category, string> = {
  ramp: "Ramp", draw: "Draw", cardSelection: "Card selection", targetedRemoval: "Removal",
  stackInteraction: "Stack interaction", boardWipe: "Board wipes", burn: "Burn & drain", stax: "Stax",
  protection: "Protection", tutor: "Tutors", lands: "Lands",
};
export const CATEGORY_ORDER: Category[] = [
  "ramp", "draw", "cardSelection", "targetedRemoval", "stackInteraction",
  "boardWipe", "burn", "stax", "protection", "tutor", "lands",
];

// Paints the identity gradient into a 1px border by layering two backgrounds: the
// inner rectangle (padding-box) matches the page so it reads as empty, the outer
// rectangle (border-box) carries the gradient — a plain `border` can't take a
// gradient directly.
const selectedChipStyle: CSSProperties = {
  border: "1px solid transparent",
  backgroundImage: "linear-gradient(var(--background), var(--background)), var(--accent-gradient)",
  backgroundOrigin: "border-box",
  backgroundClip: "padding-box, border-box",
};

export function CardList({ cards }: { cards: DeckReport["cards"] }) {
  const [filter, setFilter] = useState<Category | "all">("all");
  const present = new Set(cards.flatMap((c) => (c.roles ?? []) as Category[]));
  const categories = CATEGORY_ORDER.filter((c) => present.has(c));
  const visible = cards
    .filter((c) => (filter === "all" ? true : (c.roles ?? []).includes(filter)))
    .slice()
    .sort((a, b) => (b.synergyRating ?? 0) - (a.synergyRating ?? 0) || a.name.localeCompare(b.name));

  const chip = (key: Category | "all", label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      className={`eyebrow px-2 py-1 rounded-(--radius) border ${filter === key ? "text-(--accent)" : "border-(--separator)"}`}
      style={filter === key ? selectedChipStyle : undefined}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <h3 className="eyebrow">Cards</h3>
      <div className="flex gap-2 flex-wrap">
        {chip("all", "All")}
        {categories.map((c) => chip(c, CATEGORY_LABELS[c]))}
      </div>
      {visible.length === 0 ? (
        <p className="text-(--muted) text-sm">No cards match this filter.</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-(--border)">
              <th className="eyebrow text-left font-normal py-2 pr-2 w-10">#</th>
              <th className="eyebrow text-left font-normal py-2 pr-2">Card</th>
              <th className="eyebrow text-left font-normal py-2 pr-2 w-56">Roles</th>
              <th className="eyebrow text-right font-normal py-2 w-20">Synergy</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c, i) => {
              const reason = c.topPartners?.[0]?.reasons?.[0]?.text;
              const roles = (c.roles ?? []) as Category[];
              return (
                <tr key={c.name} className="border-b border-(--separator) align-top">
                  <td className="py-2 pr-2 font-mono tabular-nums text-(--muted)">{String(i + 1).padStart(2, "0")}</td>
                  <td className="py-2 pr-2 min-w-0">
                    <span className="block truncate">{c.name}</span>
                    {reason ? <span className="block text-xs text-(--muted) truncate">{reason}</span> : null}
                  </td>
                  <td className="py-2 pr-2">
                    <span className="flex flex-wrap gap-1">
                      {roles.map((r) => (
                        <span key={r} className="eyebrow px-1.5 py-0.5 rounded-(--radius) border border-(--separator) text-(--muted)">
                          {CATEGORY_LABELS[r]}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-(--accent)">
                    {c.synergyRating !== undefined ? c.synergyRating.toFixed(1) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
