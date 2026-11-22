/** A REASON BUILT ON A CONDITIONAL DEATH IS WEIGHED BELOW A CERTAIN ONE (#1734, owner ruling 2026-11-22: "marked conditional", "weighed below a certain fill, the way gated effects are weighed", #1357).
 *  Derive flags the `dies` a damage emit records for the creatures it hits (`GameEvent.conditional`: damage kills only what its amount allows, CR 704.5g). The reason that fill makes carries `conditional: true` for display and
 *  `strength` for the score: `impactWeightOf` multiplies it in and `impactEdgeWeight` keeps the best reason per tag, so a certain reason on the same tag still wins.
 *  The strength is the one fixed weight a gated effect nothing settles gets (`effect-gate-weight.json`, `unreadable`: 0.5, "more often than not"), read from the same datum so the two cannot drift; a damage amount is no more readable
 *  against the board than an unknown gate is. CEILING: one weight for every damage emit, whatever its amount; "deals 1 damage" and "deals 8 damage" weigh the same. */
import config from "./effect-gate-weight.json" with { type: "json" };

export const CONDITIONAL_FILL_STRENGTH: number = config.unreadable;

/** The fields a reason takes when the event it was built on is conditional; nothing otherwise. */
export function conditionalMark(e: { conditional?: true }): { conditional?: true; strength?: number } {
  return e.conditional === true ? { conditional: true, strength: CONDITIONAL_FILL_STRENGTH } : {};
}
