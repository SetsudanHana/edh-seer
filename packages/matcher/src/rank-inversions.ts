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
 *  Re-registered acceptance for the magnitude discount, BOTH parts (spec §4.2):
 *    1. total inversions FALL;
 *    2. no PROTECTED payoff's HEADLINE rating (`synergyRating`) FALLS. Protected = majority-payoff
 *       (`authority >= roleBlend * feederLift`). `payoffRating` itself cannot fall under a
 *       discount-only term (the discount never reaches `support`, and the deck denominator can only
 *       fall), so gating on it would be a gate that could never fire — the headline is what the
 *       product shows and what part 2 has to protect. Falls among majority-feeder cards are counted
 *       and printed but gate nothing.
 */
import { ratio, type SupplyDemandRow } from "./supply-demand.js";

export interface CardRatings {
  /** 0–5 payoff-role rating, keyed by card name. A missing name is UNMEASURABLE, never 0. */
  payoff: ReadonlyMap<string, number>;
  /** 0–5 feeder-role rating, same denominator. */
  feeder: ReadonlyMap<string, number>;
  /** The blended `synergyRating` — what the product shows, and what part 2 gates on. */
  headline: ReadonlyMap<string, number>;
  /** Cards whose headline is majority-payoff (`authority >= roleBlend * feederLift`): the
   *  PROTECTED set. These must not lose headline rating. */
  majorityPayoff: ReadonlySet<string>;
}

export interface PayoffRating {
  tag: string;
  name: string;
  /** The PAYOFF-role rating this row is judged on. */
  rating: number;
  /** The card's blended headline rating. Part 2 reads this, not `rating`: a discount-only term
   *  cannot lower `authority` and `deckMax` can only fall, so `rating` weakly RISES at every BETA
   *  and a gate on it could never fire. */
  headline: number;
  /** True when this payoff is in the protected majority-payoff set. */
  protectedPayoff: boolean;
  /** Cards supplying this shape whose FEEDER rating exceeds this payoff's PAYOFF rating. */
  feedersAbove: number;
}

export interface InversionReport {
  /** Shapes examined — those over the glut threshold. */
  shapes: number;
  inversions: number;
  payoffs: PayoffRating[];
  /** Payoffs skipped because `ratings.payoff` had no entry — a token node, ABSENT from
   *  `report.cards` by construction, not zero-rated. Counted so the exclusion is visible.
   *  A (deck, shape, payoff) ROW-OCCURRENCE count, not a count of distinct unmeasurable cards,
   *  exactly as `unmeasurableFeederPairs` below: one token payoff increments this once per
   *  glutted shape it sits in, not once total. */
  unmeasurablePayoffs: number;
  /** Feeder instances skipped for the same reason, one per (payoff, feeder) pair examined — a
   *  PAIR-OCCURRENCE count, not a count of distinct unmeasurable cards, exactly as `inversions`
   *  itself counts per pair: one token feeder increments this once for every payoff it is
   *  compared against, not once total. */
  unmeasurableFeederPairs: number;
}

export interface InversionDiff {
  inversionsBefore: number;
  inversionsAfter: number;
  shapesBefore: number;
  shapesAfter: number;
  /** Protected (majority-payoff) payoffs whose HEADLINE rating fell. Part 2 of the criterion says
   *  this must be empty. */
  headlineFallenProtected: { tag: string; name: string; from: number; to: number }[];
  /** Majority-feeder payoffs whose HEADLINE rating fell. Reported for visibility; gates nothing. */
  headlineFallenOther: { tag: string; name: string; from: number; to: number }[];
  unmeasurablePayoffsBefore: number;
  unmeasurablePayoffsAfter: number;
  unmeasurableFeederPairsBefore: number;
  unmeasurableFeederPairsAfter: number;
}

export function countInversions(
  rows: readonly SupplyDemandRow[],
  ratings: CardRatings,
  opts: { glut: number },
): InversionReport {
  const out: InversionReport = { shapes: 0, inversions: 0, payoffs: [], unmeasurablePayoffs: 0, unmeasurableFeederPairs: 0 };
  for (const row of rows) {
    const r = ratio(row, "avail");
    if (r === null || r <= opts.glut) continue;
    out.shapes++;
    for (const payoff of row.demand.names) {
      // A payoff ABSENT from the ratings map (a token node — the ratings pass never reads one)
      // is unmeasurable, not the worst possible rating. Scoring it 0 would manufacture an
      // inversion against every real feeder; skip it and count the exclusion instead.
      if (!ratings.payoff.has(payoff)) { out.unmeasurablePayoffs++; continue; }
      // The headline map is keyed by `has(c.synergyRating)` while the payoff map above is keyed by
      // `has(c.payoffRating)` — two DIFFERENT predicates over the same `report.cards` array that
      // only coincide because `analyze.ts` happens to set both fields in one object literal. Falling
      // back to the payoff rating here would silently read a PAYOFF rating as a headline if they
      // ever diverge, and a payoff rating cannot fall under a discount-only term (§4.2), so the gate
      // would quietly start passing. Treat a missing headline exactly like a missing payoff rating:
      // unmeasurable, skip the whole row, reusing the counter that already exists for the sibling case.
      if (!ratings.headline.has(payoff)) { out.unmeasurablePayoffs++; continue; }
      const rating = ratings.payoff.get(payoff)!;
      const headline = ratings.headline.get(payoff)!;
      // A card on BOTH sides of one shape cannot invert against itself.
      let feedersAbove = 0;
      for (const f of row.supply.names) {
        if (f === payoff) continue;
        if (!ratings.feeder.has(f)) { out.unmeasurableFeederPairs++; continue; }
        if (ratings.feeder.get(f)! > rating) feedersAbove++;
      }
      out.inversions += feedersAbove;
      out.payoffs.push({
        tag: row.key, name: payoff, rating,
        headline,
        protectedPayoff: ratings.majorityPayoff.has(payoff),
        feedersAbove,
      });
    }
  }
  return out;
}

export function diffInversions(a: InversionReport, b: InversionReport): InversionDiff {
  // A pre-per-role snapshot has no `headline`/`protectedPayoff` on its payoff rows. Diffing against
  // one silently reads `undefined` on both sides: `now.headline >= before.headline` is false for
  // every row (a false `undefined >= undefined`), so every row files as a fall, and
  // `before.protectedPayoff` is falsy so every fall lands in `headlineFallenOther` — printing
  // "0 row(s) ... <- clears" on the gate that decides whether a discount may ship, from the wrong
  // file, silently. Refuse rather than guess.
  for (const rep of [a, b]) {
    if (rep.payoffs.some((p) => typeof p.headline !== "number" || typeof p.protectedPayoff !== "boolean")) {
      throw new Error("snapshot predates the per-role fields; re-take the baseline");
    }
  }
  const byKey = (rep: InversionReport) => new Map(rep.payoffs.map((p) => [`${p.tag}::${p.name}`, p] as const));
  const after = byKey(b);
  const headlineFallenProtected: InversionDiff["headlineFallenProtected"] = [];
  const headlineFallenOther: InversionDiff["headlineFallenOther"] = [];
  for (const [k, before] of byKey(a)) {
    const now = after.get(k);
    if (!now || now.headline >= before.headline) continue;
    const row = { tag: before.tag, name: before.name, from: before.headline, to: now.headline };
    (before.protectedPayoff ? headlineFallenProtected : headlineFallenOther).push(row);
  }
  return {
    inversionsBefore: a.inversions,
    inversionsAfter: b.inversions,
    shapesBefore: a.shapes,
    shapesAfter: b.shapes,
    headlineFallenProtected,
    headlineFallenOther,
    unmeasurablePayoffsBefore: a.unmeasurablePayoffs,
    unmeasurablePayoffsAfter: b.unmeasurablePayoffs,
    unmeasurableFeederPairsBefore: a.unmeasurableFeederPairs,
    unmeasurableFeederPairsAfter: b.unmeasurableFeederPairs,
  };
}
