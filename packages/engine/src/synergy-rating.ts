/** Stage 1 of the signed-synergy-verdict plan: normalize the raw, unbounded per-card
 *  synergy score into a deck-relative 0–5 rating, and average nonland cards into a
 *  0–5 deck positive-coherence number. Deck-relative on purpose — a 5 means "top
 *  engine piece OF THIS DECK". Axis-weighting happens upstream in the matcher; this
 *  helper only normalizes. */

const round1 = (x: number): number => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export interface RatedInput {
  name: string;
  /** Raw damped synergy score (≥ 0, unbounded). */
  score: number;
  /** Lands are excluded from the coherence average (structurally carry no synergy). */
  isNonland: boolean;
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

  const nonland = inputs.filter((i) => i.isNonland);
  const positiveCoherence =
    nonland.length === 0
      ? 0
      : round1(nonland.reduce((sum, i) => sum + (ratingByName.get(i.name) ?? 0), 0) / nonland.length);

  return { ratingByName, positiveCoherence };
}
