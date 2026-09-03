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

/** THE FOUR BANDS AS A SENTENCE, printed rather than hidden in a `title` — a tooltip does not exist
 *  on touch at all, and a reader who cannot see where 4.1 sits on the scale cannot read the figure.
 *
 *  BUILT FROM `SCORE_BREAKS`, NOT RETYPED (MINOR G, whole-branch review, 2026-09-01). It was a
 *  third hand-copy of the same four thresholds `scoreBand` and the score dial's arc already carry
 *  as data — exactly the drift risk `Dial.tsx`'s `SCORE_ZONES` comment names for the arc. It lives
 *  beside the thresholds now (it was in `HeadlineScores`, which S15 retired into the dials), so a
 *  moved break shows up in the printed scale with no second edit. */
export const bandScale = (): string[] => {
  const edges = [0, ...SCORE_BREAKS, 5];
  return edges
    .slice(0, -1)
    .map((from, i) => `${from}–${edges[i + 1]} ${scoreBand(from).label.toLowerCase()}`);
};

/** The same four bands as one string, for anywhere that wants a sentence rather than a strip. */
export const bandLegend = (): string => bandScale().join(" · ");
