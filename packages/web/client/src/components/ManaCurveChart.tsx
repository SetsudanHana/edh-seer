import type { DeckReport } from "../types.js";

const CHART_HEIGHT = 120;
const LABEL_ALLOWANCE = 20;

export function ManaCurveChart({ curve }: { curve: DeckReport["manaCurve"] }) {
  const max = Math.max(1, ...curve.map((b) => b.count));
  const peakIndex = curve.reduce((best, b, i) => (b.count > curve[best].count ? i : best), 0);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Mana curve</h3>
      <div className="flex items-end gap-0.5" style={{ height: CHART_HEIGHT }}>
        {curve.map((b, i) => {
          const heightPx = Math.round((b.count / max) * (CHART_HEIGHT - LABEL_ALLOWANCE));
          const label = b.value === 7 ? "7+" : String(b.value);
          return (
            <div
              key={b.value}
              className="flex-1 flex flex-col items-center justify-end gap-1"
              title={`${b.count} card${b.count === 1 ? "" : "s"} at mana value ${label}`}
            >
              {i === peakIndex && b.count > 0 ? (
                <span className="font-mono text-xs text-(--foreground)">{b.count}</span>
              ) : null}
              <div className="w-full max-w-6 bg-(--accent) rounded-t-[4px]" style={{ height: `${heightPx}px` }} />
              <span className="font-mono text-[10px] text-(--muted)">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
