/** DOES A SHAPE'S MARGINAL SUPPLY OUTRANK THE SCARCE PAYOFF IT FEEDS?
 *
 *  The one direction-correctness question the ratings diff cannot answer. `ratings-compare.ts`
 *  reports that N ratings moved; it has no opinion on whether they moved the right way, and the
 *  other three gates (population, panel, build) are blind to a pure scoring multiplier by design.
 *
 *  Definition: within a shape whose `avail` supply:demand ratio exceeds `glut`, an INVERSION is a
 *  supplying card rated strictly above a consuming card. Counted per (payoff, feeder) pair, so one
 *  badly-placed payoff under thirty feeders counts thirty — the magnitude of the wrongness is the
 *  point.
 *
 *  Pre-registered acceptance for the magnitude discount, BOTH parts (spec §5):
 *    1. total inversions FALL;
 *    2. the count of scarce payoffs whose rating FELL is ZERO.
 */
import { ratio, type SupplyDemandRow } from "./supply-demand.js";

export interface PayoffRating {
  tag: string;
  name: string;
  rating: number;
  /** Cards supplying this shape that are rated strictly above this payoff. */
  feedersAbove: number;
}

export interface InversionReport {
  /** Shapes examined — those over the glut threshold. */
  shapes: number;
  inversions: number;
  payoffs: PayoffRating[];
  /** Payoffs skipped because `ratingByName` had no entry — a token node, ABSENT from
   *  `report.cards` by construction, not zero-rated. Counted so the exclusion is visible. */
  unmeasurablePayoffs: number;
  /** Feeder instances skipped for the same reason, one per (payoff, feeder) pair examined. */
  unmeasurableFeeders: number;
}

export interface InversionDiff {
  inversionsBefore: number;
  inversionsAfter: number;
  shapesBefore: number;
  shapesAfter: number;
  /** Scarce payoffs that LOST rating. The criterion says this must be empty. */
  payoffsFallen: { tag: string; name: string; from: number; to: number }[];
  unmeasurablePayoffsBefore: number;
  unmeasurablePayoffsAfter: number;
  unmeasurableFeedersBefore: number;
  unmeasurableFeedersAfter: number;
}

export function countInversions(
  rows: readonly SupplyDemandRow[],
  ratingByName: ReadonlyMap<string, number>,
  opts: { glut: number },
): InversionReport {
  const out: InversionReport = { shapes: 0, inversions: 0, payoffs: [], unmeasurablePayoffs: 0, unmeasurableFeeders: 0 };
  for (const row of rows) {
    const r = ratio(row, "avail");
    if (r === null || r <= opts.glut) continue;
    out.shapes++;
    for (const payoff of row.demand.names) {
      // A payoff ABSENT from the ratings map (a token node — the ratings pass never reads one)
      // is unmeasurable, not the worst possible rating. Scoring it 0 would manufacture an
      // inversion against every real feeder; skip it and count the exclusion instead.
      if (!ratingByName.has(payoff)) {
        out.unmeasurablePayoffs++;
        continue;
      }
      const rating = ratingByName.get(payoff)!;
      // A card on BOTH sides of one shape cannot invert against itself.
      let feedersAbove = 0;
      for (const f of row.supply.names) {
        if (f === payoff) continue;
        if (!ratingByName.has(f)) { out.unmeasurableFeeders++; continue; }
        if (ratingByName.get(f)! > rating) feedersAbove++;
      }
      out.inversions += feedersAbove;
      out.payoffs.push({ tag: row.key, name: payoff, rating, feedersAbove });
    }
  }
  return out;
}

export function diffInversions(a: InversionReport, b: InversionReport): InversionDiff {
  const byKey = (rep: InversionReport) => new Map(rep.payoffs.map((p) => [`${p.tag}::${p.name}`, p] as const));
  const after = byKey(b);
  const payoffsFallen: InversionDiff["payoffsFallen"] = [];
  for (const [k, before] of byKey(a)) {
    const now = after.get(k);
    if (now && now.rating < before.rating) {
      payoffsFallen.push({ tag: before.tag, name: before.name, from: before.rating, to: now.rating });
    }
  }
  return {
    inversionsBefore: a.inversions,
    inversionsAfter: b.inversions,
    shapesBefore: a.shapes,
    shapesAfter: b.shapes,
    payoffsFallen,
    unmeasurablePayoffsBefore: a.unmeasurablePayoffs,
    unmeasurablePayoffsAfter: b.unmeasurablePayoffs,
    unmeasurableFeedersBefore: a.unmeasurableFeeders,
    unmeasurableFeedersAfter: b.unmeasurableFeeders,
  };
}
