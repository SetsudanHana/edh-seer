import type { Reason } from "@mtg/engine";
import { cardThemeTags } from "./edges.js";
import type { DeckCard } from "./types.js";

/** Share of the deck that may supply a tag by baseline alone before the tag stops being a theme
 *  and becomes deck arithmetic. Calibrated on packages/cli/decks/calibration (71 decks) — see
 *  bin/theme-cal.ts, which re-derives it and prints the plateau. */
export const BASELINE_CAP = 0.55;

export interface ThemeMembership {
  tag: string;
  surplus: string[];
  payoffs: string[];
  baseline: string[];
  selective: boolean;
  members: string[];
}

/** Split every card's relation to each candidate tag into the three that are not equivalent:
 *  SURPLUS (an authored effect supplies more of the event than the card's existence implies — a
 *  fetchland's second land-ETB), PAYOFF (triggers on it, or is statically improved by it), and
 *  BASELINE (the card's existence supplies exactly one occurrence — a Forest, a bear, a bolt).
 *
 *  Baseline is admitted only when the tag is selective in this deck. A payoff reading "whenever a
 *  creature enters" is fed by every creature and its baseline carries no information; Inalla's
 *  "nontoken Wizard" filter makes the same kind of supply scarce and therefore meaningful. */
export function themeMembership(
  deckCards: DeckCard[],
  reasons: Reason[],
  tags: string[],
  baselineCap: number = BASELINE_CAP,
): ThemeMembership[] {
  const total = deckCards.length || 1;
  return tags.map((tag) => {
    const surplus = new Set<string>();
    const baseline = new Set<string>();
    const payoffs = new Set<string>();

    for (const r of reasons) {
      if (r.tag !== tag) continue;
      if (r.consumer) payoffs.add(r.consumer);
      if (!r.producer) continue;
      if (r.impliedProducer) baseline.add(r.producer);
      else surplus.add(r.producer);
    }
    // A card's own theme tags are authored by construction: cardThemeTags reads trigger verbs,
    // authored emits and static effects, never a card's implied self-event. So a card carrying
    // the tag with no edge to show for it is still a real participant, not baseline.
    for (const dc of deckCards) {
      if (dc.tags && cardThemeTags(dc.tags).has(tag)) surplus.add(dc.card.name);
    }
    // A card that both produces surplus and supplies baseline is a surplus producer.
    for (const n of surplus) baseline.delete(n);

    const selective = baseline.size <= baselineCap * total;
    const members = new Set([...surplus, ...payoffs]);
    if (selective) for (const n of baseline) members.add(n);

    return {
      tag,
      surplus: [...surplus].sort(),
      payoffs: [...payoffs].sort(),
      baseline: [...baseline].sort(),
      selective,
      members: [...members].sort(),
    };
  });
}
