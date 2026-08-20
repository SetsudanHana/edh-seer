import { landHandProbabilities } from "../lib/land-math.js";
import { BarChart } from "./BarChart.js";

/** THE OPENING HAND, AS A SENTENCE. The full distribution is a function of the land count and the
 *  deck size and nothing else — it says the same thing for every 100-card deck running 37 lands —
 *  so a chart of eight bars was spending the Overview's most valuable vertical space on an
 *  arithmetic identity. The number a player acts on is one figure: how often the hand is keepable
 *  on lands, which for a 7-card hand is three or more. The distribution stays one click away for
 *  the reader who wants the shape.
 *  → `specs/2026-08-20-report-usability-review.md` §4 */
export function LandMathChart({ landCount, deckSize }: { landCount: number; deckSize: number }) {
  const probs = landHandProbabilities(landCount, deckSize);
  const threePlus = probs.slice(3).reduce((a, b) => a + b, 0);
  const oneOrNone = probs[0]! + probs[1]!;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Lands in your opening 7</h3>
      <p className="text-sm text-(--muted)">
        <span className="text-(--foreground) tabular-nums">{Math.round(threePlus * 100)}%</span> of
        opening hands have three or more lands;{" "}
        <span className="text-(--foreground) tabular-nums">{Math.round(oneOrNone * 100)}%</span> have
        one or none.
      </p>
      <details>
        <summary className="eyebrow cursor-pointer text-(--muted)">the whole distribution</summary>
        <div className="pt-2">
          <BarChart
            heading=""
            ariaLabel="Lands in your opening seven, full distribution"
            bars={probs.map((p, k) => ({
              label: String(k),
              value: p,
              title: `${Math.round(p * 100)}% chance of exactly ${k} land${k === 1 ? "" : "s"}`,
            }))}
            formatTick={(v) => `${Math.round(v * 100)}%`}
            peakLabel={(b) => `${Math.round(b.value * 100)}%`}
          />
        </div>
      </details>
    </div>
  );
}
