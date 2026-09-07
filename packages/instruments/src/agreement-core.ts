/** The arithmetic behind a judge-agreement round, apart from the draw so it can be tested without
 *  Mongo. Same rates round 3's `score.py` computed, and the reason they are here rather than inline
 *  is that they decide a REGISTERED verdict: strict vs lenient is the whole difference between
 *  round 3's REAL stratum reading 4.4% and reading 0.0%.
 *
 *  `partial` is a third answer the owner has used in every round. Strict counts it as disagreement,
 *  lenient drops those rows from the denominator — the panel's own treatment of `uncertain`. */

export interface StratumScore {
  stratum: "real" | "false";
  n: number;
  strict: number;
  strictRate: number;
  strictBound: [number, number];
  lenientN: number;
  lenient: number;
  lenientRate: number;
  lenientBound: [number, number];
  partial: number;
  /** Ids that disagree with the cached verdict, ascending. */
  disagreed: number[];
}

/** Wilson score interval as a percentage pair. `n === 0` has no interval; [0, 0] says so. */
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96, p = k / n, den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [100 * (centre - half), 100 * (centre + half)];
}

/** One stratum's disagreement rate. `cached` is the sealed key; `human` is what the owner answered.
 *  A row missing from `human` is UNJUDGED and counts in neither numerator nor denominator. */
export function scoreStratum(
  stratum: "real" | "false",
  cached: Record<string, string>,
  human: Map<number, string>,
): StratumScore {
  const agrees = stratum === "real" ? "true" : "false";
  const ids = [...human.keys()].filter((i) => cached[String(i)] === stratum).sort((a, b) => a - b);
  const partial = ids.filter((i) => human.get(i) === "partial");
  const disagreed = ids.filter((i) => human.get(i) !== agrees);
  const lenientN = ids.length - partial.length;
  const lenient = disagreed.filter((i) => !partial.includes(i)).length;
  return {
    stratum, n: ids.length, disagreed, partial: partial.length,
    strict: disagreed.length,
    strictRate: ids.length === 0 ? 0 : (100 * disagreed.length) / ids.length,
    strictBound: wilson(disagreed.length, ids.length),
    lenientN, lenient,
    lenientRate: lenientN === 0 ? 0 : (100 * lenient) / lenientN,
    lenientBound: wilson(lenient, lenientN),
  };
}
