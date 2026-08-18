/** Stage 1 of the signed-synergy-verdict plan: normalize the raw, unbounded per-card
 *  synergy score into a deck-relative 0–5 rating, and compute axis COVERAGE — the
 *  average on-axis edge strength across the deck — into a 0–5 deck
 *  positive-coherence number. Deck-relative on purpose — a 5 means "top engine piece
 *  OF THIS DECK" for the per-card rating, and "the whole deck serves the plan" for
 *  coverage. Axis-weighting happens upstream in the matcher; this helper only
 *  normalizes. */

const round1 = (x: number): number => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export interface RatedInput {
  name: string;
  /** Raw damped synergy score (≥ 0, unbounded). */
  score: number;
  /** √support — what this card earns as the PAYOFF of its edges (the existing `authority`). */
  payoffScore: number;
  /** √feederSum — what it earns as a FEEDER of other cards' payoffs. */
  feederScore: number;
  /** Lands are infrastructure — excluded from coverage UNLESS the land itself has an on-axis edge. */
  isNonland: boolean;
  /** Best on-axis edge weight for this card, in [0,1] (0 = off-axis). The strongest normalized
   *  axis weight among the card's synergy edges. Graded coverage averages these. */
  axisWeight: number;
}

export interface SynergyRatings {
  ratingByName: Map<string, number>;
  /** 0–5 on the SAME deck denominator as `ratingByName`: the payoff half of the headline. */
  payoffRatingByName: Map<string, number>;
  /** 0–5 on the same denominator: the feeder half, BEFORE `roleBlend` is applied. */
  feederRatingByName: Map<string, number>;
  positiveCoherence: number;
}

export function computeSynergyRatings(inputs: RatedInput[]): SynergyRatings {
  const ratingByName = new Map<string, number>();
  const payoffRatingByName = new Map<string, number>();
  const feederRatingByName = new Map<string, number>();
  // deckMax includes the commander's own COMMANDER_BOOST-inflated score (the commander is
  // usually every other card's highest-weighted partner), so the commander typically anchors
  // this 5-ceiling. Worth revisiting alongside future AXIS_BOOST / commander-weight tuning.
  const deckMax = inputs.reduce((m, i) => Math.max(m, i.score), 0);
  // ONE denominator for all three. An own-role denominator would read better per role (the best
  // payoff would always be 5.0) but puts the two on unrelated scales, so a feeder's number could
  // not be compared against a payoff's and the components would not sum to the headline.
  const rate = (x: number): number => (deckMax > 0 ? clamp(round1((5 * x) / deckMax), 0, 5) : 0);

  for (const input of inputs) {
    ratingByName.set(input.name, rate(input.score));
    payoffRatingByName.set(input.name, rate(input.payoffScore));
    feederRatingByName.set(input.name, rate(input.feederScore));
  }

  // Graded coverage (breadth × strength): each counted card contributes its best on-axis edge
  // weight. Denominator = nonland cards plus any LAND that itself has an on-axis edge (a utility
  // land like Gaea's Cradle; a basic land is infrastructure, excluded). A nonland with weight 0
  // stays in the denominator and drags coverage down (dead weight), by design. Replaces the old
  // BINARY count-based coverage, which was brittle (threshold cliffs) on real decks.
  const counted = inputs.filter((i) => i.isNonland || i.axisWeight > 0);
  const sum = counted.reduce((s, i) => s + i.axisWeight, 0);
  const positiveCoherence = counted.length === 0 ? 0 : round1((5 * sum) / counted.length);

  return { ratingByName, payoffRatingByName, feederRatingByName, positiveCoherence };
}
