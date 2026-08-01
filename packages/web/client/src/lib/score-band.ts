export type ScoreTone = "low" | "mid" | "good" | "high";

/** Map a 0–5 deck-quality score to a band label + semantic tone. Thresholds are tunable
 *  starting points; tone maps to a color token in the component, not here. */
export function scoreBand(score: number): { label: string; tone: ScoreTone } {
  if (score >= 4) return { label: "Tuned", tone: "high" };
  if (score >= 3) return { label: "Focused", tone: "good" };
  if (score >= 1.5) return { label: "Developing", tone: "mid" };
  return { label: "Unfocused", tone: "low" };
}
