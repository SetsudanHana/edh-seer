/** Inputs to the land-count regression. Every one of them is a COUNT of cards, except the average,
 *  which is over nonlands only -- lands have no mana value to average. */
export interface KarstenInputs {
  /** Average mana value of the NONLAND cards. `computeDeckStats().avgManaValue` already excludes
   *  lands, which is the figure the regression was fitted on. */
  avgManaValue: number;
  /** Cheap ramp and cheap card draw, at 0.28 of a land each: Llanowar Elves, Rampant Growth,
   *  Arcane Signet, a cantrip. */
  rampPlusDraw: number;
  /** Nonland cards costing 0 that repeatedly produce mana -- the Moxen, Mana Crypt, Chrome Mox.
   *  Worth a WHOLE land each, and keeping these out of `rampPlusDraw` is the single correction the
   *  spec says most implementations miss. */
  fastMana: number;
  commanders?: number;
  /** Modal double-faced cards with a land back, split by whether that land enters untapped. Detected
   *  from `layout` + the back face's text in `landInputs` since 2026-08-19 — before that both were
   *  hardcoded 0 and a deck running them read land-heavy by roughly 0.4-0.7 of a land each.
   *  TRANSFORM cards are not these: their land back cannot be played. */
  mdfcUntapped?: number;
  mdfcTapped?: number;
}

/** Frank Karsten's land-count regression, scaled to Commander (spec §2.1, Tier B: published and
 *  independently confirmed -- not something this project fitted).
 *
 *  The `-1.35` accounts for guaranteed commander access, the turn-1 draw, and the free mulligan,
 *  which is also why the mulligan is not modelled anywhere else in this layer.
 *
 *  KNOWN CEILING, and it is why this cannot be the whole story: it reads avg mana value only, never
 *  CURVE SHAPE. A bimodal 2-and-6 deck and a flat 4 deck get the same answer. The regression
 *  absorbs that empirically rather than correctly.
 *
 *  It also has NO COLOUR TERM. Land count barely depends on how many colours you play; composition
 *  does, and that is `manaAudit`'s question, not this one. Do not let a reader infer otherwise. */
export function karstenLands({
  avgManaValue, rampPlusDraw, fastMana,
  commanders = 1, mdfcUntapped = 0, mdfcTapped = 0,
}: KarstenInputs): number {
  const raw =
    ((100 - commanders) / 60) * (19.59 + 1.9 * avgManaValue + 0.27 * commanders)
    - 0.28 * rampPlusDraw
    - 1.0 * fastMana
    - 0.74 * mdfcUntapped
    - 0.38 * mdfcTapped
    - 1.35;
  // The regression is fitted, not derived, and carries no floor: enough ramp and fast mana walks it
  // below zero, and "play -2 lands" is not advice.
  return Math.max(0, raw);
}
