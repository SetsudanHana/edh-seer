import { useState } from "react";
import type { CSSProperties } from "react";
import type { DeckReport } from "../types.js";

type Category =
  | "ramp" | "draw" | "cardSelection" | "targetedRemoval" | "stackInteraction"
  | "boardWipe" | "burn" | "stax" | "protection" | "tutor" | "lands";

// Exported for this file's own filter chips below. GraphView used to reuse these for its
// role-ring zone labels; the graph names roles itself now (presets.ts's ROLE_GROUPS, which groups
// these same categories into the six a deck is read by) -- these are plain internal exports again.
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

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** The mana axis as the interval it is: lands only at the low end, plus the rocks already castable
 *  at the high one. Collapsed to a single figure when the deck runs no rock cheap enough to widen
 *  it, so a rockless deck does not read "31% - 31%". */
export const castRange = (c: { mana: number; manaWithRocks: number }): string =>
  pct(c.manaWithRocks) === pct(c.mana) ? pct(c.mana) : `${pct(c.mana)} – ${pct(c.manaWithRocks)}`;

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
              {/* COST BESIDE THE RATING, NEVER MULTIPLIED INTO IT. What a card does and what it
                *  costs are two facts, and a reader weighing "is this 9-drop worth it" needs both
                *  in view -- the same never-multiply ruling the castability axes already ship. */}
              <th className="eyebrow text-right font-normal py-2 pr-2 w-32">Cost</th>
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
                  <td className="py-2 pr-2 text-right">
                    {/* An em dash for a land or an unpriced cost -- a refusal must never render as
                      *  0%, which a reader would take as "you cannot cast this". */}
                    <span className="block font-mono tabular-nums">{c.manaCost ?? "—"}</span>
                    {c.castability ? (
                      <span className="block text-xs text-(--muted) tabular-nums">
                        {castRange(c.castability)} by T{c.castability.turn}
                      </span>
                    ) : null}
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
