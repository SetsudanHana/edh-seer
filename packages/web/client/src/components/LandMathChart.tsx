import { landHandProbabilities } from "../lib/land-math.js";
import { BarChart } from "./BarChart.js";

export function LandMathChart({ landCount, deckSize }: { landCount: number; deckSize: number }) {
  const probs = landHandProbabilities(landCount, deckSize);
  return (
    <BarChart
      heading="Lands in your opening 7"
      bars={probs.map((p, k) => ({
        label: String(k),
        value: p,
        title: `${Math.round(p * 100)}% chance of exactly ${k} land${k === 1 ? "" : "s"}`,
      }))}
      formatTick={(v) => `${Math.round(v * 100)}%`}
      peakLabel={(b) => `${Math.round(b.value * 100)}%`}
    />
  );
}
