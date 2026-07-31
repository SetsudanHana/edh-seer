import { landHandProbabilities } from "../lib/land-math.js";

const CHART_HEIGHT = 120;
const LABEL_ALLOWANCE = 20;

export function LandMathChart({ landCount, deckSize }: { landCount: number; deckSize: number }) {
  const probs = landHandProbabilities(landCount, deckSize);
  const max = Math.max(1e-9, ...probs);
  const peakIndex = probs.reduce((best, p, i) => (p > probs[best] ? i : best), 0);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Lands in your opening 7</h3>
      <div className="flex items-end gap-0.5" style={{ height: CHART_HEIGHT }}>
        {probs.map((p, k) => {
          const heightPx = Math.round((p / max) * (CHART_HEIGHT - LABEL_ALLOWANCE));
          const pct = Math.round(p * 100);
          return (
            <div
              key={k}
              className="flex-1 flex flex-col items-center justify-end gap-1"
              title={`${pct}% chance of exactly ${k} land${k === 1 ? "" : "s"}`}
            >
              {k === peakIndex && p > 0 ? (
                <span className="font-mono text-xs text-(--foreground)">{pct}%</span>
              ) : null}
              <div className="w-full max-w-6 bg-(--accent) rounded-t-[4px]" style={{ height: `${heightPx}px` }} />
              <span className="font-mono text-[10px] text-(--muted)">{k}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
