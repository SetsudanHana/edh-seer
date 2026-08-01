import type { DeckReport } from "../types.js";
import { scoreBand, type ScoreTone } from "../lib/score-band.js";

const TONE_CLASS: Record<ScoreTone, string> = {
  low: "text-(--danger)",
  mid: "text-(--warning)",
  good: "text-(--success)",
  high: "text-(--success)",
};

function ScoreTile({ label, score, sub }: { label: string; score: number; sub?: string }) {
  const band = scoreBand(score);
  return (
    <div
      title={`${label} ${score.toFixed(1)} of 5 — ${band.label}. 0–1.5 Unfocused · 1.5–3 Developing · 3–4 Focused · 4–5 Tuned.`}
      className="flex-1 min-w-0 flex flex-col gap-0.5 rounded-lg border border-(--separator) p-4"
    >
      <span className="eyebrow">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className={`text-3xl font-semibold tabular-nums ${TONE_CLASS[band.tone]}`}>{score.toFixed(1)}</span>
        <span className="text-sm text-(--muted)">/5</span>
      </span>
      <span className={`text-sm ${TONE_CLASS[band.tone]}`}>{band.label}</span>
      {sub ? <span className="text-xs text-(--muted)">{sub}</span> : null}
    </div>
  );
}

export function HeadlineScores({ report }: { report: DeckReport }) {
  const { synergyOverall, buildScore, positiveCoherence, anchoring } = report;
  if (synergyOverall === undefined && buildScore === undefined) return null;
  const sub =
    positiveCoherence !== undefined || anchoring !== undefined
      ? `breadth ${(positiveCoherence ?? 0).toFixed(1)} · anchor ${(anchoring ?? 0).toFixed(1)}`
      : undefined;
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      {synergyOverall !== undefined ? <ScoreTile label="SYNERGY" score={synergyOverall} sub={sub} /> : null}
      {buildScore !== undefined ? <ScoreTile label="BUILD" score={buildScore} /> : null}
    </div>
  );
}
