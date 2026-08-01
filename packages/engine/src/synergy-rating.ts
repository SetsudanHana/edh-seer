/** Stage 1 of the signed-synergy-verdict plan: normalize the raw, unbounded per-card
 *  synergy score into a deck-relative 0–5 rating, and compute axis COVERAGE — the
 *  share of the deck that carries an on-axis synergy edge — into a 0–5 deck
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
  /** Lands are infrastructure — excluded from coverage UNLESS the land itself has an on-axis edge. */
  isNonland: boolean;
  /** True iff the card has ≥1 on-axis synergy edge (an edge whose reasons touch the deck axis). */
  onAxis: boolean;
}

export interface SynergyRatings {
  ratingByName: Map<string, number>;
  positiveCoherence: number;
}

export function computeSynergyRatings(inputs: RatedInput[]): SynergyRatings {
  const ratingByName = new Map<string, number>();
  // deckMax includes the commander's own COMMANDER_BOOST-inflated score (the commander is
  // usually every other card's highest-weighted partner), so the commander typically anchors
  // this 5-ceiling. Worth revisiting alongside future AXIS_BOOST / commander-weight tuning.
  const deckMax = inputs.reduce((m, i) => Math.max(m, i.score), 0);

  for (const input of inputs) {
    const rating = deckMax > 0 ? clamp(round1((5 * input.score) / deckMax), 0, 5) : 0;
    ratingByName.set(input.name, rating);
  }

  // Coverage (breadth): how much of the deck serves the plan. Denominator = nonland cards
  // plus any LAND that itself has an on-axis edge (a utility land like Gaea's Cradle that
  // serves the plan counts; a basic land is infrastructure, excluded). Numerator = of those,
  // the cards with an on-axis edge. A nonland with no on-axis edge stays in the denominator
  // and drags coverage down (dead weight), by design. Replaces the old mean-of-ratings, which
  // was structurally capped near ~1.5 and could never reach 5.
  const denom = inputs.filter((i) => i.isNonland || i.onAxis);
  const numer = inputs.filter((i) => i.onAxis);
  const positiveCoherence = denom.length === 0 ? 0 : round1((5 * numer.length) / denom.length);

  return { ratingByName, positiveCoherence };
}
