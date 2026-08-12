/** What the board is allowed to get wrong, per deck fixture and preset.
 *
 *  WHY THIS IS A RATCHET AND NOT A THRESHOLD. The five-fixture harness found 21 hard-condition
 *  failures on decks that had never been measured, and five attempts to fix the largest family
 *  (overlaps) all measured worse — see 2026-08-12-board-layout-review.md §4b/§4c. The owner's call
 *  was to stop treating them as pass/fail. The obvious form, "soft above some room size", turned out
 *  to be unsupported by the data: room size does not predict overlaps at all. Measured, ten trials
 *  each —
 *
 *      braids/Role      7 rooms, largest 26 cards (35% of deck)  ->  56 overlaps
 *      fairdrazi/Role   7 rooms, largest 33 cards (35% of deck)  ->   3 overlaps
 *      inalla/Type      6 rooms, largest 34 cards (36% of deck)  ->   0 overlaps
 *
 *  Same room count, same or larger rooms, same fraction of the deck, and the counts run 56 to 0.
 *  Room count, largest-room size, largest-room fraction, mean membership, circle-area coverage and
 *  board spread were all checked; none separates the clean cases from the dirty ones. Any threshold
 *  would have been fitted to whichever decks happen to be checked in, and would have silently
 *  stopped protecting the rest.
 *
 *  So: a cap per case, at the value measured today. Two directions, both failures, which is what
 *  makes it a ratchet rather than a budget:
 *    - ABOVE the cap is a regression.
 *    - BELOW the cap must be banked by lowering the number, or the next regression hides inside the
 *      slack. This is the same rule pair-calibration.test.ts and derive-compass.test.ts already run
 *      on, and both directions there are proven to fire.
 *
 *  A CAP OF 0 IS THE HARD CONDITION, unchanged. Nothing currently clean is weakened by this table;
 *  it only writes down where the board already fails. 13 of the 25 cases are zero on
 *  all four counts.
 *
 *  Raise a number only with a written reason. Lower it the moment something improves.
 */

/** Every fixture the gate covers, by the basename of its `<name>-graph.json`. Adding a deck here
 *  puts it in the harness AND requires a row below -- board-acceptance.test.ts fails otherwise, so a
 *  newly captured deck cannot slip into the gate without someone looking at what it does. */
export const FIXTURES = ["sorin", "inalla", "fairdrazi", "changelings", "braids"];

/** Totals across the harness's ten seeded trials, not per-trial. */
export interface Caps {
  /** A single-room card outside its own room. The board failing at the one thing it claims. */
  escapesOne: number;
  /** Two card discs closer than 2 * ART_RADIUS. */
  overlaps: number;
  /** A card inside a room it does not belong to. */
  intrusions: number;
  /** Cards the projection could not place, counted against the circles as drawn. */
  unresolved: number;
}

/** Keyed `<fixture>/<preset label>`. Every fixture x preset the harness runs needs an entry --
 *  board-acceptance.test.ts fails if one is missing, so a newly captured deck cannot join the
 *  harness without someone looking at what it does. */
export const ACCEPTANCE: Record<string, Caps> = {
  "sorin/Role":              { escapesOne: 0, overlaps:   3, intrusions:  0, unresolved:   0 },
  "sorin/Type":              { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "sorin/Colour":            { escapesOne: 0, overlaps:  31, intrusions:  0, unresolved:   0 },
  "sorin/Mana value":        { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "sorin/Subtype":           { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "inalla/Role":             { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "inalla/Type":             { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "inalla/Colour":           { escapesOne: 0, overlaps:  11, intrusions:  0, unresolved:   2 },
  "inalla/Mana value":       { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "inalla/Subtype":          { escapesOne: 0, overlaps:   1, intrusions:  0, unresolved:  31 },
  "fairdrazi/Role":          { escapesOne: 0, overlaps:   3, intrusions:  6, unresolved:  28 },
  "fairdrazi/Type":          { escapesOne: 0, overlaps:   2, intrusions:  0, unresolved:   0 },
  "fairdrazi/Colour":        { escapesOne: 0, overlaps: 108, intrusions: 44, unresolved: 220 },
  "fairdrazi/Mana value":    { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "fairdrazi/Subtype":       { escapesOne: 0, overlaps:   4, intrusions:  0, unresolved:   0 },
  "changelings/Role":        { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "changelings/Type":        { escapesOne: 0, overlaps:   1, intrusions:  0, unresolved:   0 },
  "changelings/Colour":      { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "changelings/Mana value":  { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "changelings/Subtype":     { escapesOne: 0, overlaps:   0, intrusions:  2, unresolved:  27 },
  "braids/Role":             { escapesOne: 0, overlaps:  56, intrusions:  9, unresolved:  37 },
  "braids/Type":             { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "braids/Colour":           { escapesOne: 0, overlaps: 253, intrusions:  0, unresolved:   0 },
  "braids/Mana value":       { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "braids/Subtype":          { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
};

export const zero: Caps = { escapesOne: 0, overlaps: 0, intrusions: 0, unresolved: 0 };
