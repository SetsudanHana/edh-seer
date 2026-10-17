import type { Ability } from "@edh-seer/tagger";

/** THE ONE READER OF `Ability.claimsNothing` (#1264): the stored reason an ability claims no cards, or
 *  undefined when it claims as usual. Derive decides it (#1253 "refused-trigger", #1252 "self-loss"); the
 *  matcher never recomputes it from emits. `FACT_KINDS` and `ownBoardKill` (edges.ts) stay matcher rules:
 *  the first is per channel, the second depends on the deck. */
export function claimsNothing(a: Ability): Ability["claimsNothing"] {
  return a.claimsNothing;
}
/** A refused trigger's ability: no emit, demand or supply, though it still counts as a triggered ability (CR 603.1). */
export const isRefusedTrigger = (a: Ability): boolean => claimsNothing(a) === "refused-trigger";
/** A self "you lose the game" ability (owner ruling 2026-10-16/17, #1252): its emits reach a rescue consumer only. */
export const isSelfLoss = (a: Ability): boolean => claimsNothing(a) === "self-loss";
