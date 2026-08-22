/** HOW MANY PEOPLE ARE PLAYING. CR 903.2 + 806: the default Commander game is Free-for-All
 *  multiplayer, attack-multiple-players, no limited range of influence — four players, each at 40
 *  life, so each player faces THREE opponents.
 *
 *  A CONSTANT WITH AN OVERRIDE, not a hardcoded 4 (owner, 2026-08-22: *"default math is assuming 4
 *  people, but you can have 3 or 5 people games"*). The pod size is a property of the GAME being
 *  analysed, not of the deck, and a three-player table is an ordinary thing to sit at.
 *
 *  WHAT IT DOES NOT CHANGE, and both are decisions rather than omissions:
 *  - **The clock stays measured against ONE opponent** (`pressure.ts`). Its own comment argues it:
 *    "a deck that can kill the table three times over is not three times as fast, it is a deck that
 *    has to attack three different players." A bigger pod does not shorten your clock.
 *  - **No target moves with pod size.** Board wipes really are worth more against three boards, and
 *    that is roadmap J7 — REFUSED, because no gate here can judge a game-length estimate, so tuning
 *    an Interaction floor to the pod is tuning against nothing.
 *
 *  WHAT IT ACTUALLY REACHES TODAY IS ONE CARD, and that is the honest size of it: **Spectator
 *  Seating** enters tapped "unless you have two or more opponents", so it is untapped at a pod of 3+
 *  and tapped in a duel. Everything else that will read this is unbuilt (roadmap I11's simulator).
 *  The constant exists NOW so that three separate items do not each invent their own 4. */
export const DEFAULT_POD_SIZE = 4;

/** The fewest players a game can have. Below this there is no opponent and every "each opponent"
 *  effect reads as a no-op, so it is clamped rather than trusted — this value will one day arrive
 *  from a UI field, and a pod of 0 must not silently become a deck that answers nothing. */
export const MIN_POD_SIZE = 2;

/** Opponents faced, from the pod size. The number every "each opponent" question actually wants. */
export function opponents(podSize: number = DEFAULT_POD_SIZE): number {
  return Math.max(MIN_POD_SIZE, Math.floor(podSize)) - 1;
}
