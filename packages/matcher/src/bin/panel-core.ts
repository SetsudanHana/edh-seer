/** The frozen panel: a fixed set of card PAIRS whose claims carry permanent verdicts.
 *
 *  Why this exists (`docs/superpowers/specs/2026-08-05-edge-precision-measurement-design.md` §23):
 *  fresh sampling cannot track the changes being made to this engine. At n=150 an arm's 95% interval
 *  is 12–16 points wide, and a 2–5% change to the reason population moves precision by 1–3 points, so
 *  three consecutive draws all read "no measurable change" and a fourth read a 6-point move on a
 *  population NOTHING had touched. Each draw resamples everything, so the noise is redrawn every time.
 *
 *  A panel holds the population fixed instead. The same pairs are re-scored after every change, so a
 *  difference is PAIRED and the sampling noise mostly cancels — the comparison is "did these claims
 *  get better", not "are these two random samples different".
 *
 *  Two things make it survive changes in BOTH directions, which is where `precision-recheck` stops
 *  (its warrant holds only while the population shrinks):
 *    - the unit is the PAIR, so a change that alters which claims a pair produces does not invalidate
 *      the panel; it just changes what needs looking up.
 *    - a verdict is cached per CLAIM and never expires, so removals cost nothing and additions cost
 *      only the additions. That cost is reported as `unjudged` — the judging DEBT — and a change that
 *      adds claims cannot silently inflate precision, because unjudged claims are owed, not real. */

export type Verdict = "real" | "false" | "uncertain";

export interface PanelVerdict {
  producer: string;
  consumer: string;
  tag: string;
  verdict: Verdict;
  cause: string;
  note: string;
  /** WHICH MECHANISM this verdict was made against. A claim's `producer|consumer|tag` is NOT its
   *  identity: the same triple can be asserted through an authored ability one day and through the
   *  producer's own entry the next, and a verdict made against the first then scores the second.
   *
   *  Measured (Fable review, 2026-08-15): Goldspan Dragon -> Terror of the Peaks was cached `real`
   *  for the right reason, the 2026-08-07 re-judge overturned it to `false` reading Goldspan's
   *  TREASURE ability, and round 3 then drew that stale `false` against a claim asserting Goldspan's
   *  own ENTRY. Origin of Metalbending -> Leyline of Resonance has the identical history. Those
   *  became 2 of the 11 disagreements that kept precision withdrawn.
   *
   *  BACKWARD COMPATIBLE ON PURPOSE. Absent — which every verdict written before today is — means
   *  "not recorded", and the claim scores exactly as it did before. A verdict that DOES carry it and
   *  disagrees with the live claim is treated as UNJUDGED, so the mismatch surfaces as judging debt
   *  instead of a silently wrong score. Protection accrues to new verdicts rather than invalidating
   *  1,661 old ones. */
  implied?: boolean;
}

/** One claim as the engine currently states it. */
export interface PanelClaim {
  producer: string;
  consumer: string;
  tag: string;
  /** The producer supplies this event merely BY BEING ITSELF — a creature entering, an instant being
   *  cast — rather than through an authored ability. Carried so a worksheet can SAY so: three of the
   *  four claims Claude wrongly judged false in the agreement draw were this shape. */
  implied?: boolean;
}

export interface PanelScore {
  real: number;
  false: number;
  uncertain: number;
  /** Claims the engine makes today that no verdict covers. The debt to pay before the next reading. */
  unjudged: PanelClaim[];
  /** Cached verdicts the engine no longer claims. Kept, not deleted: the change may be reverted. */
  dropped: number;
  precision: number | null;
}

/** A claim's identity. Directed, because `directedReasons` is: "A supplies B" and "B supplies A" are
 *  different assertions and were judged separately. */
export function claimKey(producer: string, consumer: string, tag: string): string {
  return `${producer}|${consumer}|${tag}`;
}

/** Fold new verdicts over old. Later wins, so a corrected judgment supersedes without the caller
 *  having to find and delete the original — 17 of the first 600 rows needed exactly that. */
export function mergeVerdicts(
  existing: readonly PanelVerdict[],
  incoming: readonly PanelVerdict[],
): PanelVerdict[] {
  const by = new Map<string, PanelVerdict>();
  for (const v of existing) by.set(claimKey(v.producer, v.consumer, v.tag), v);
  for (const v of incoming) by.set(claimKey(v.producer, v.consumer, v.tag), v);
  return [...by.values()];
}

export function scorePanel(
  current: readonly PanelClaim[],
  cache: readonly PanelVerdict[],
): PanelScore {
  const by = new Map(cache.map((v) => [claimKey(v.producer, v.consumer, v.tag), v]));
  const seen = new Set<string>();
  const out: PanelScore = { real: 0, false: 0, uncertain: 0, unjudged: [], dropped: 0, precision: null };
  for (const c of current) {
    const k = claimKey(c.producer, c.consumer, c.tag);
    seen.add(k);
    const v = by.get(k);
    if (!v) { out.unjudged.push(c); continue; }
    // The verdict was made against a DIFFERENT mechanism than the engine now asserts. Owe it again
    // rather than score it — see `PanelVerdict.implied`.
    if (v.implied !== undefined && v.implied !== (c.implied === true)) { out.unjudged.push(c); continue; }
    if (v.verdict === "real") out.real++;
    else if (v.verdict === "false") out.false++;
    else out.uncertain++;
  }
  out.dropped = [...by.keys()].filter((k) => !seen.has(k)).length;
  const decided = out.real + out.false;
  if (decided > 0) out.precision = out.real / decided;
  return out;
}

/** 95% Wilson interval, in percent. Same estimator as `precision-core.wilson`, restated in percent
 *  here so the panel report reads without a conversion step at the call site. */
export function wilsonPanel(successes: number, total: number): [number, number] {
  if (total === 0) return [0, 100];
  const z = 1.959964;
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, ((centre - spread) / denom) * 100), Math.min(100, ((centre + spread) / denom) * 100)];
}
