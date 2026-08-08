import type { DeckReport } from "../types.js";
import { BarChart } from "./BarChart.js";

export function ManaCurveChart({ curve }: { curve: DeckReport["manaCurve"] }) {
  return (
    <BarChart
      heading="Mana curve"
      bars={curve.map((b) => {
        const label = b.value === 7 ? "7+" : String(b.value);
        return {
          label,
          value: b.count,
          title: `${b.count} card${b.count === 1 ? "" : "s"} at mana value ${label}`,
        };
      })}
      formatTick={String}
      peakLabel={(b) => String(b.value)}
    />
  );
}
