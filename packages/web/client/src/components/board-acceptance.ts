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
 *  it only writes down where the board already fails. 19 of the 25 cases are zero on
 *  all four counts.
 *
 *  Raise a number only with a written reason. Lower it the moment something improves.
 *
 *  RAISES SO FAR, each with its reason.
 *
 *  3. FOREIGN_MARGIN 40 (2026-08-12) -- foreignPush reaching past a room's rim instead of waiting
 *  for a card to be inside it: 10 counts fell, 3 rose, and all three rises are 2 counts. Chosen
 *  over margin 90 because across ten cases it beat the reactive behaviour on ALL THREE totals at
 *  once (overlaps 48 -> 35, intrusions 36 -> 24, unresolved 94 -> 58) where 90 traded overlaps up
 *  for intrusions down.
 *
 *  2. Normalising roomAttraction by room size (2026-08-12) and deleting the universal-room
 *  exemption with it: 15 counts fell, 7 rose, and every rise is between 1 and 4 counts. Compared
 *  with the state before ANY of this day's board work, braids/Role went 56 overlaps / 9 intrusions
 *  / 37 unresolved to zero on all three, sorin/Colour 31 overlaps to 0, and fairdrazi/Colour
 *  108 / 44 / 220 to 33 / 28 / 75. 18 of 25 cases are now clean on all four counts, up from 13.
 *
 *  1. forceRoomBreathing (2026-08-12) lets a
 *  room whose members are actually colliding grow, and it was a TRADE, not a free win: 13 counts
 *  fell and 6 rose. It was taken because the counts it fixes are the ones a viewer sees -- cards
 *  drawn on top of each other -- while the ones it costs are `unresolved`, which counts cards the
 *  projection could not place against geometry, the softest of the four. The inline comments below
 *  carry every before -> after.
 *
 *  The wins are the two boards the five-fixture harness was added to expose: braids/Colour goes
 *  253 overlaps to ZERO, and fairdrazi/Colour improves on overlaps AND intrusions at once
 *  (108 -> 38, 44 -> 29), which no other attempt on this family managed in either direction.
 *  sorin/Colour is the clearest cost: two rooms covering one deck, so growing both makes them
 *  overlap each other far more, 31 -> 50.
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
  "sorin/Role":            { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "sorin/Type":            { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "sorin/Colour":          { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "sorin/Mana value":      { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "sorin/Subtype":         { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "inalla/Role":           { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "inalla/Type":           { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "inalla/Colour":         { escapesOne: 0, overlaps:   4, intrusions:  6, unresolved:   3 },  // overlaps 12->4, intrusions 4->6, unresolved 8->3
  "inalla/Mana value":     { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "inalla/Subtype":        { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   8 },  // overlaps 1->0, unresolved 5->8
  "fairdrazi/Role":        { escapesOne: 0, overlaps:   1, intrusions:  0, unresolved:   5 },  // overlaps 2->1, intrusions 1->0, unresolved 3->5
  "fairdrazi/Type":        { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "fairdrazi/Colour":      { escapesOne: 0, overlaps:  29, intrusions: 17, unresolved:  50 },  // overlaps 33->29, intrusions 28->17, unresolved 75->50
  "fairdrazi/Mana value":  { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "fairdrazi/Subtype":     { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "changelings/Role":      { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "changelings/Type":      { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "changelings/Colour":    { escapesOne: 0, overlaps:   0, intrusions:  1, unresolved:   0 },
  "changelings/Mana value":{ escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "changelings/Subtype":   { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },  // intrusions 2->0, unresolved 8->0
  "braids/Role":           { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "braids/Type":           { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "braids/Colour":         { escapesOne: 0, overlaps:   1, intrusions:  0, unresolved:   0 },
  "braids/Mana value":     { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
  "braids/Subtype":        { escapesOne: 0, overlaps:   0, intrusions:  0, unresolved:   0 },
};

export const zero: Caps = { escapesOne: 0, overlaps: 0, intrusions: 0, unresolved: 0 };
