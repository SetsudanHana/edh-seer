import { useState } from "react";
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

export function CardList({ cards }: { cards: DeckReport["cards"] }) {
  const [filter, setFilter] = useState<Bucket | "all">("all");
  const visible = cards
    .filter((c) => (filter === "all" ? true : scoreFor(c, filter) > 0))
    .slice()
    .sort((a, b) => maxScore(b) - maxScore(a) || a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`eyebrow px-2 py-1 rounded-(--radius) border ${
            filter === "all" ? "border-(--accent) text-(--accent)" : "border-(--separator)"
          }`}
        >
          All
        </button>
        {BUCKETS.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setFilter(b)}
            className={`eyebrow px-2 py-1 rounded-(--radius) border ${
              filter === b ? "border-(--accent) text-(--accent)" : "border-(--separator)"
            }`}
          >
            {BUCKET_LABELS[b]}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="text-(--muted) text-sm">No cards match this filter.</p>
      ) : (
        <ul className="flex flex-col">
          {visible.map((c) => (
            <li key={c.name} className="flex items-center gap-3 py-2 border-b border-(--separator)">
              <span className="flex-1 min-w-0 truncate">{c.name}</span>
              <span className="flex gap-1 shrink-0">
                {BUCKETS.filter((b) => scoreFor(c, b) > 0).map((b) => (
                  <span
                    key={b}
                    title={`${BUCKET_LABELS[b]}: ${scoreFor(c, b).toFixed(2)}`}
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: `var(--bucket-${b})` }}
                  />
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
