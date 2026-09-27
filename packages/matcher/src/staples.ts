/** WHAT PLAYERS ACTUALLY CONSIDER A STAPLE (owner, 2026-09-27): EDHTop16's competitive play rate over
 *  the last year, taken ONCE as a committed snapshot -- "one time off calibration for us". Not fetched
 *  at build time; a refresh is a deliberate new snapshot (`bin/gen-staples-snapshot.ts`). Keyed by
 *  Scryfall oracle id, the corpus's own key. Credit EDHTop16 wherever a number from it is shown. */
import snapshot from "../staples-edhtop16.json" with { type: "json" };

export interface StaplesSnapshot {
  /** ISO date the snapshot was taken. */
  fetchedAt: string;
  source: string;
  /** oracle id -> play rate 0..1 among the tournament decks that could play the card. */
  cards: Record<string, number>;
}

export function loadStaples(): StaplesSnapshot { return snapshot as StaplesSnapshot; }
