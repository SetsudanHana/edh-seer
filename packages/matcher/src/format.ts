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

/** CR 903.8 — THE COMMANDER TAX. Each previous cast FROM THE COMMAND ZONE adds {2} to the cost.
 *
 *  THE LARGEST UNMODELLED COST IN THE FORMAT, and it stays unmodelled on purpose (roadmap J5): the
 *  tax is a function of how many times the commander has been CAST from the zone, which is a
 *  function of how many times it has DIED — and nothing here simulates a game. The goldfish model
 *  (I11) casts no removal and has no opponent, so it cannot answer it either.
 *
 *  SO WHAT SHIPS IS A CAVEAT, NOT A NUMBER, exactly as the item asked. A commander is priced at
 *  **P = 1** in `availability.ts` and `deck-math.ts` and reported as "available every game", which is
 *  TRUE and invites being read as free and repeatable. It is free ONCE. */
export const COMMANDER_TAX_PER_CAST = 2;

/** What the Nth cast from the command zone costs on top of the printed mana value. Zero for the
 *  first. A function rather than a bare constant because the interesting figure is the TOTAL a
 *  player has paid by the time they are casting it again, and every future reader of 903.8 wants
 *  that rather than the increment. */
export function commanderTax(castNumber: number): number {
  return Math.max(0, Math.floor(castNumber) - 1) * COMMANDER_TAX_PER_CAST;
}

/** The sentence that goes beside the P = 1 figure. Shipped as DATA on the report rather than written
 *  into each renderer: **no subpath of `@mtg/matcher` is safe to value-import from client code** — a
 *  recorded critical regression (BuildBenchmarks.tsx, 2026-08-21) — so a shared constant is the only
 *  way both surfaces can say the same thing without one of them drifting. */
export const COMMANDER_TAX_CAVEAT =
  `free the first time only — each recast from the command zone costs {${COMMANDER_TAX_PER_CAST}} more `
  + "(CR 903.8), and nothing here models how often it dies";
