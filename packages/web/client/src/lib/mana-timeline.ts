import type { DeckReport } from "../types.js";

export interface TimelineColumn {
  turn: number;
  mana: { median: number; p25: number; p75: number };
  /** Cards whose cost this deck's median mana FIRST covers on this turn. */
  unlocked: number;
}

export interface ManaTimeline {
  columns: TimelineColumn[];
  /** Cards the median never pays for inside the simulated turns, and the last turn simulated. */
  never: { count: number; afterTurn: number };
  /** The largest single unlock, for the sentence. Null when nothing stands out. */
  peak: { turn: number; count: number } | null;
}

/** SUPPLY AND DEMAND ON ONE TURN AXIS, and the join between them is MEASURED rather than assumed.
 *
 *  THE TWO SERIES DO NOT SHARE AN AXIS ON THEIR OWN. `manaCurve` is indexed by MANA VALUE and
 *  counts CARDS; `manaAvailability.rows` is indexed by TURN and reports MANA. Putting the curve on
 *  a turn axis needs a rule for which turn a cost belongs to, and the obvious one -- "a 3-drop is a
 *  turn-3 card" -- is the on-curve CONVENTION, which is a player's rule of thumb and not a fact
 *  about this deck.
 *
 *  So the rule here is the deck's own simulation: a cost belongs to the first turn this deck's
 *  MEDIAN mana covers it. On a deck that ramps, costs land earlier than the convention says; on one
 *  that stalls they land later, or never. Measured on the review deck, where it is not a
 *  distinction without a difference: MV 6 lands on turn SEVEN because the median sits at 5 through
 *  turn 6, and MV 7+ is never covered inside the eight simulated turns at all -- nine cards the
 *  convention would have drawn as fine.
 *
 *  THE MEDIAN, AND SAID SO WHEREVER IT IS SHOWN. Half the games do better and half worse; the
 *  p25-p75 band travels with it on the chart for exactly that reason. A first-payable turn computed
 *  off a median is not a promise about any one game. */
export function manaTimeline(
  curve: DeckReport["manaCurve"],
  rows: NonNullable<DeckReport["manaAvailability"]>["rows"],
): ManaTimeline | null {
  if (rows.length === 0) return null;
  const byTurn = [...rows].sort((a, b) => a.turn - b.turn);
  const last = byTurn[byTurn.length - 1]!;

  const columns: TimelineColumn[] = byTurn.map((r) => ({
    turn: r.turn,
    mana: r.mana,
    unlocked: 0,
  }));

  let never = 0;
  for (const bucket of curve) {
    if (bucket.count === 0) continue;
    // A ZERO-COST CARD IS PAYABLE BEFORE ANY MANA EXISTS, so it belongs to the first turn rather
    // than to a turn-0 column nothing else occupies.
    const i = bucket.value <= 0
      ? 0
      : byTurn.findIndex((r) => r.mana.median >= bucket.value);
    if (i === -1) never += bucket.count;
    else columns[i]!.unlocked += bucket.count;
  }

  const peak = columns.reduce<{ turn: number; count: number } | null>(
    (best, c) => (c.unlocked > (best?.count ?? 0) ? { turn: c.turn, count: c.unlocked } : best),
    null,
  );

  return { columns, never: { count: never, afterTurn: last.turn }, peak };
}
