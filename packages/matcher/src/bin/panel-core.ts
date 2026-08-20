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

/** Does this verdict come from the OWNER? The panel's authority order, stated once: the user judges,
 *  Claude proposes. `panel-score.ts --rejudge` already excludes these rows for the same reason —
 *  re-judging them would overwrite the answer with the thing being tested. */
export const isUserVerdict = (v: PanelVerdict): boolean => v.note.startsWith("USER VERDICT");

/** Fold new verdicts over old. Later wins, so a corrected judgment supersedes without the caller
 *  having to find and delete the original — 17 of the first 600 rows needed exactly that.
 *
 *  EXCEPT THAT A USER VERDICT IS NEVER OVERWRITTEN BY A CLAUDE ONE, whatever the order. Measured on
 *  the cache 2026-08-20: of 64 claims whose duplicate rows DISAGREE, **44 are exactly this shape** —
 *  the owner overriding an earlier Claude verdict, with notes that say so ("OVERRIDES Claude's cached
 *  false"). Order alone carried that rule, which is why `panel-build.ts` and the raw file disagreed
 *  on 8 claims and read 92.0% against 93.8%: the file is in append order, a rebuild is in source
 *  order. Encoding the authority makes the merge insensitive to order for those 44; the remaining 20
 *  (17 Claude-vs-Claude, 3 owner-vs-owner) are genuine chronology and are settled ONCE by
 *  de-duplicating the cache in append order. */
/** The key a verdict is DEDUPED on, which is not the key it is looked up by.
 *
 *  `implied` marks the mechanism the verdict was made against — a producer supplying an event by
 *  BEING itself, rather than through an authored ability — and `scorePanel` owes the claim again
 *  when the two disagree. So two rows sharing a triple but differing on `implied` are verdicts about
 *  DIFFERENT THINGS and both must survive; collapsing them cost two judged claims the first time
 *  this dedupe was attempted (Hornet Nest -> Enduring Innocence, Aragorn -> Prowl), each of which
 *  had an owner verdict on the authored mechanism and a Claude verdict on the implied one.
 *
 *  A row with no `implied` at all is the wildcard the field's absence has always meant, and keeps its
 *  own slot. */
export const verdictKey = (v: PanelVerdict): string =>
  `${claimKey(v.producer, v.consumer, v.tag)}|${v.implied === undefined ? "*" : v.implied}`;

export function mergeVerdicts(
  existing: readonly PanelVerdict[],
  incoming: readonly PanelVerdict[],
): PanelVerdict[] {
  const by = new Map<string, PanelVerdict>();
  for (const v of existing) by.set(verdictKey(v), v);
  for (const v of incoming) {
    const k = verdictKey(v);
    const held = by.get(k);
    if (held && isUserVerdict(held) && !isUserVerdict(v)) continue;
    by.set(k, v);
  }
  return [...by.values()];
}

export function scorePanel(
  current: readonly PanelClaim[],
  cache: readonly PanelVerdict[],
): PanelScore {
  // LOOKUP AS PRECISE AS STORAGE. A verdict is stored per MECHANISM (`implied`), so consulting the
  // cache by triple alone made the score depend on which row happened to sit LAST in the file — the
  // same claim reading 93.6% or 94.3% purely from row order, which is what made a rebuild unsafe to
  // run. The exact mechanism wins; a row with no `implied` is the wildcard its absence has always
  // meant and is the fallback.
  const exact = new Map<string, PanelVerdict>();
  const wildcard = new Map<string, PanelVerdict>();
  for (const v of cache) {
    const k = claimKey(v.producer, v.consumer, v.tag);
    if (v.implied === undefined) wildcard.set(k, v);
    else exact.set(`${k}|${v.implied}`, v);
  }
  const seen = new Set<string>();
  const out: PanelScore = { real: 0, false: 0, uncertain: 0, unjudged: [], dropped: 0, precision: null };
  for (const c of current) {
    const k = claimKey(c.producer, c.consumer, c.tag);
    seen.add(k);
    const v = exact.get(`${k}|${c.implied === true}`) ?? wildcard.get(k);
    if (!v) { out.unjudged.push(c); continue; }
    if (v.verdict === "real") out.real++;
    else if (v.verdict === "false") out.false++;
    else out.uncertain++;
  }
  // "Cached verdicts the engine no longer claims" counts CLAIMS, so it counts distinct triples
  // across both maps — a claim with a verdict for each mechanism is one dropped claim, not two.
  const cachedClaims = new Set([...wildcard.keys(), ...[...exact.keys()].map((k) => k.slice(0, k.lastIndexOf("|")))]);
  out.dropped = [...cachedClaims].filter((k) => !seen.has(k)).length;
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
