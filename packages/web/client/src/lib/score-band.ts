export type ScoreTone = "low" | "mid" | "good" | "high";

/** THE BAND EDGES, AS DATA. `scoreBand` reads them and so does the score dial's arc, which used to
 *  transcribe them into needle-space by hand -- two copies of one set of thresholds, one of which
 *  would have gone stale silently the first time a band moved. Ordered low to high. */
export const SCORE_BREAKS = [1.5, 3, 4] as const;

/** Map a 0–5 deck-quality score to a band label + semantic tone. Thresholds are tunable
 *  starting points; tone maps to a color token in the component, not here. */
export function scoreBand(score: number): { label: string; tone: ScoreTone } {
  if (score >= SCORE_BREAKS[2]) return { label: "Tuned", tone: "high" };
  if (score >= SCORE_BREAKS[1]) return { label: "Focused", tone: "good" };
  if (score >= SCORE_BREAKS[0]) return { label: "Developing", tone: "mid" };
  return { label: "Unfocused", tone: "low" };
}
