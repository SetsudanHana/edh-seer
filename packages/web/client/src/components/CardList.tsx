import { useState } from "react";
import type { CSSProperties } from "react";
import type { DeckReport } from "../types.js";

type Bucket = "consistency" | "efficiency" | "synergy" | "win-condition";

const BUCKETS: Bucket[] = ["consistency", "efficiency", "synergy", "win-condition"];

const BUCKET_LABELS: Record<Bucket, string> = {
  consistency: "Consistency",
  efficiency: "Efficiency",
  synergy: "Synergy",
  "win-condition": "Win Condition",
};

function scoreFor(card: DeckReport["cards"][number], bucket: Bucket): number {
  if (bucket === "synergy") return card.score;
  return card.bucketScores?.[bucket] ?? 0;
}

function maxScore(card: DeckReport["cards"][number]): number {
  return Math.max(...BUCKETS.map((b) => scoreFor(card, b)));
}

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
  const [filter, setFilter] = useState<Bucket | "all">("all");
  const visible = cards
    .filter((c) => (filter === "all" ? true : scoreFor(c, filter) > 0))
    .slice()
    .sort((a, b) => maxScore(b) - maxScore(a) || a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-3">
      <h3 className="eyebrow">Cards</h3>
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`eyebrow px-2 py-1 rounded-(--radius) border ${
            filter === "all" ? "text-(--accent)" : "border-(--separator)"
          }`}
          style={filter === "all" ? selectedChipStyle : undefined}
        >
          All
        </button>
        {BUCKETS.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setFilter(b)}
            className={`eyebrow px-2 py-1 rounded-(--radius) border ${
              filter === b ? "text-(--accent)" : "border-(--separator)"
            }`}
            style={filter === b ? selectedChipStyle : undefined}
          >
            {BUCKET_LABELS[b]}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="text-(--muted) text-sm">No cards match this filter.</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-(--border)">
              <th className="eyebrow text-left font-normal py-2 pr-2 w-10">#</th>
              <th className="eyebrow text-left font-normal py-2 pr-2">Card</th>
              <th className="eyebrow text-left font-normal py-2 pr-2 w-32">Roles</th>
              <th className="eyebrow text-right font-normal py-2 w-20">Synergy</th>
              <th className="eyebrow text-right font-normal py-2 w-16">Score</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c, i) => (
              <tr key={c.name} className="border-b border-(--separator)">
                <td className="py-2 pr-2 font-mono tabular-nums text-(--muted)">{String(i + 1).padStart(2, "0")}</td>
                <td className="py-2 pr-2 min-w-0 truncate">{c.name}</td>
                <td className="py-2 pr-2">
                  <span className="flex gap-1">
                    {BUCKETS.filter((b) => scoreFor(c, b) > 0).map((b) => (
                      <span
                        key={b}
                        title={`${BUCKET_LABELS[b]}: ${scoreFor(c, b).toFixed(2)}`}
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: `var(--bucket-${b})` }}
                      />
                    ))}
                  </span>
                </td>
                <td className="py-2 pr-2 text-right font-mono tabular-nums text-(--accent)">
                  {c.synergyRating !== undefined ? c.synergyRating.toFixed(1) : "—"}
                </td>
                <td className="py-2 text-right font-mono tabular-nums text-(--foreground)">
                  {maxScore(c).toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
