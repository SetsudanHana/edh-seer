/** G1, THE SAME-JOB GATE (docs/plans/2026-10-04-same-job-review.md): of the labelled swap pairs a
 *  same-job rule puts together, how many are labelled "same", and how many labelled "different" it
 *  puts together anyway. The gate is purity >= 90% and no "different" pair together. A pair the
 *  owner marked unsure is `excluded` and not scored. */
export type Label = "same" | "weak" | "different";
export interface Scored { label: Label; together: boolean; excluded?: boolean }
export interface Purity {
  scored: number; together: number; same: number; weak: number; different: number;
  /** same / together; null when the rule puts nothing together. */
  purity: number | null;
  /** Of the pairs labelled same, how many the rule puts together. */
  sameFound: number; sameTotal: number;
  passes: boolean;
}

export function purity(rows: readonly Scored[]): Purity {
  const live = rows.filter((r) => !r.excluded);
  const t = live.filter((r) => r.together);
  const n = (l: Label) => t.filter((r) => r.label === l).length;
  const same = n("same"), different = n("different");
  const p = t.length ? same / t.length : null;
  const sameTotal = live.filter((r) => r.label === "same").length;
  return {
    scored: live.length, together: t.length, same, weak: n("weak"), different, purity: p,
    sameFound: same, sameTotal,
    passes: p !== null && p >= 0.9 && different === 0,
  };
}
