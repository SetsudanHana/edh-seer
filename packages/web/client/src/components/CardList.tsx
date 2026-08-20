import { useState } from "react";
import type { CSSProperties } from "react";
import type { DeckReport } from "../types.js";
import { CardName } from "./card-drawer.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { Explain } from "./Explain.js";
import { distinctiveReason, reasonShapes } from "../lib/reason-shape.js";

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

/** A column header that sorts. Marked with `aria-sort` on the header cell's own button rather than
 *  a caret glyph alone, so the state is available to a reader who cannot see the accent colour. */
function SortButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`eyebrow ${active ? "text-(--accent)" : ""}`}
    >
      {label}
      {active ? <span aria-hidden="true"> ↓</span> : null}
    </button>
  );
}

/** The mana axis as the interval it is: lands only at the low end, plus the rocks already castable
 *  at the high one. Collapsed to a single figure when the deck runs no rock cheap enough to widen
 *  it, so a rockless deck does not read "31% - 31%". */
export const castRange = (c: { mana: number; manaWithRocks: number }): string =>
  pct(c.manaWithRocks) === pct(c.mana) ? pct(c.mana) : `${pct(c.mana)} – ${pct(c.manaWithRocks)}`;

type SortKey = "synergy" | "name" | "cost";

/** A RATING IS DECK-RELATIVE AND THE TABLE NEVER SAID SO. `synergyRating` is `score / deckMax`, so
 *  half a deck sits under 1.0 BY CONSTRUCTION — 51 of 94 rows on a deck this engine rates 4.1 of 5
 *  — and a card carrying a deck ROLE forms no pairwise edge on purpose (`ROLE_NOT_SYNERGY`), so
 *  Sol Ring reads 0.3 because the engine is deliberately silent about it, not because it is bad.
 *  The trim panel learned both of these twice and now protects and explains; this table was the
 *  same data with none of that language.
 *  → `specs/2026-08-20-report-usability-review.md` §3 F5 */
const SCALE_NOTE =
  "Rated against this deck's best synergy card, so a low number is a comparison and not a verdict — "
  + "lands and cards whose job is a role (ramp, removal, protection) score low by design.";

export function CardList({ cards }: { cards: DeckReport["cards"] }) {
  const [filter, setFilter] = useState<Category | "all">("all");
  const [sort, setSort] = useState<SortKey>("synergy");
  const [query, setQuery] = useState("");
  const present = new Set(cards.flatMap((c) => (c.roles ?? []) as Category[]));
  const categories = CATEGORY_ORDER.filter((c) => present.has(c));
  // ONE MECHANISM, SAID ONCE. Measured on the review deck: 94 rows carry 12 distinct reason
  // sentences and the top one covers 25 of them, so a quarter of the table repeated "X triggers on
  // a wizard entering; Inalla supplies it" with only the names changing — and the rows whose reason
  // was DIFFERENT, which is where the information is, read exactly like the rest.
  const shapes = reasonShapes(cards);
  const names = new Set(cards.map((c) => c.name));
  const needle = query.trim().toLowerCase();
  const byName = (a: DeckReport["cards"][number], b: DeckReport["cards"][number]) => a.name.localeCompare(b.name);
  const visible = cards
    .filter((c) => (filter === "all" ? true : (c.roles ?? []).includes(filter)))
    .filter((c) => needle === "" || c.name.toLowerCase().includes(needle))
    .slice()
    .sort((a, b) => {
      // Name is the tiebreak everywhere, so a sort is stable to the reader rather than to the
      // engine's iteration order.
      if (sort === "name") return byName(a, b);
      // Expensive first: the question a cost sort answers is "what am I paying the most for".
      if (sort === "cost") return (b.manaValue ?? 0) - (a.manaValue ?? 0) || byName(a, b);
      return (b.synergyRating ?? 0) - (a.synergyRating ?? 0) || byName(a, b);
    });

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
      <p className="text-xs text-(--muted) max-w-[65ch]">{SCALE_NOTE}</p>
      {/* THE COST COLUMN'S OWN SCALE. "49% – 69% by T5" was explained in a footnote on a different
        *  tab, so on this one it was two unlabelled numbers. */}
      <Explain label="what the cost figures mean">
        A range, low to high: the low number counts lands only and under-states, the high one adds
        every mana rock cheap enough to already be down and over-states, because a rock needs lands
        too. Both ignore tapped lands and colour, so both read high. The turn is the card's own mana
        value — a 5-drop is priced at turn 5 — and a land or an unpriceable cost renders an em dash
        rather than 0%.
      </Explain>
      {shapes.shared.length > 0 ? (
        <div className="text-xs text-(--muted) max-w-[65ch] flex flex-col gap-0.5">
          <span>
            Most of this deck connects in{" "}
            {shapes.shared.length === 1 ? "one way" : `${shapes.shared.length} ways`}, said once here
            instead of on every row:
          </span>
          {shapes.shared.map((sh) => (
            <span key={sh.template}>
              <span className="tabular-nums">{sh.count}</span> ×{" "}
              <span className="text-(--foreground)">{sh.sample}</span>
            </span>
          ))}
          <span>A row with a sentence of its own is a card doing something else.</span>
        </div>
      ) : null}
      <div className="flex gap-2 flex-wrap items-center">
        {chip("all", "All")}
        {categories.map((c) => chip(c, CATEGORY_LABELS[c]))}
        {/* 94 unpaginated rows with one hardcoded sort order and no way to find a card by name —
          *  below the bar every deck tool this product is measured against sets. */}
        <input
          type="search"
          aria-label="Filter cards by name"
          placeholder="Find a card…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ml-auto text-sm rounded-(--radius) border border-(--separator) bg-(--field-background) px-2 py-1"
        />
      </div>
      {visible.length === 0 ? (
        <p className="text-(--muted) text-sm">No cards match this filter.</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-(--border)">
              <th className="eyebrow text-left font-normal py-2 pr-2 w-10">#</th>
              <th className="eyebrow text-left font-normal py-2 pr-2">
                <SortButton label="Card" active={sort === "name"} onClick={() => setSort("name")} />
              </th>
              <th className="eyebrow text-left font-normal py-2 pr-2 w-56">Roles</th>
              {/* COST BESIDE THE RATING, NEVER MULTIPLIED INTO IT. What a card does and what it
                *  costs are two facts, and a reader weighing "is this 9-drop worth it" needs both
                *  in view -- the same never-multiply ruling the castability axes already ship. */}
              <th className="eyebrow text-right font-normal py-2 pr-2 w-32">
                <SortButton label="Cost" active={sort === "cost"} onClick={() => setSort("cost")} />
              </th>
              <th className="eyebrow text-right font-normal py-2 w-20">
                <SortButton label="Synergy" active={sort === "synergy"} onClick={() => setSort("synergy")} />
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c, i) => {
              const reason = distinctiveReason(c, shapes.shared, names);
              const roles = (c.roles ?? []) as Category[];
              return (
                <tr key={c.name} className="border-b border-(--separator) align-top">
                  <td className="py-2 pr-2 font-mono tabular-nums text-(--muted)">{String(i + 1).padStart(2, "0")}</td>
                  <td className="py-2 pr-2 min-w-0">
                    <CardName name={c.name} className="block truncate max-w-full" />
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
                    <span className="block"><ManaSymbols cost={c.manaCost ?? ""} /></span>
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
