/** HOW A THEME CONFIDENCE BECOMES A PERCENTAGE, in the one place that decides it.
 *
 *  FLOORED, NEVER ROUNDED. The rule is the UX sweep's (2026-09-06, D4): 0.249 printed "25%" beside a
 *  note saying the theme was under the 25% floor, so the reader saw a number the theme had not
 *  reached. The floor is what the template compares against, and rounding can only ever put the
 *  printed figure on the wrong side of it.
 *
 *  IT LIVES HERE BECAUSE IT DRIFTED. The rule was written as a comment inside `ArchetypeBoard`, and
 *  `DeckIdentity` — a different surface showing the SAME field of the SAME object — used
 *  `Math.round`. Persona round 2 (2026-09-18) caught it from pixels alone on three different decks:
 *  Glance read "Aristocrats 34% · +1/+1 Counters 21%" while the Plan bars two screens down read 33%
 *  and 20%. A rule that lives in one component's comment is a rule the next component does not have.
 *
 *  A bridging sentence would not have fixed it: two readers of one number have to agree, and then
 *  the bridge is unnecessary. */

/** Whole percent, floored. `themePct(0.249) === 24`. */
export function themePct(confidence: number): number {
  return Math.floor(confidence * 100);
}

/** One decimal, floored the same way, for the places that need the finer read against a floor —
 *  `DeckGauges` prints "reads 24.9%, under the 25% an archetype needs to set its own row". */
export function themePct1(confidence: number): string {
  return (Math.floor(confidence * 1000) / 10).toFixed(1);
}
