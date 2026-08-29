import pool from "./answer-pool.json" with { type: "json" };
import type { DeckCard } from "./types.js";

/** Every answer class the pool counts. `graveyard` is counted and stored even though
 *  `answer-coverage.ts` excludes it from the coverage denominator (design §3) -- the artifact
 *  records what the corpus contains; deciding what to score with it is a separate question. */
export const POOL_CLASSES = ["creature", "artifact", "enchantment", "planeswalker", "land", "graveyard"] as const;

/** WUBRG order, which is the order every Magic source prints an identity in. `C` for the empty
 *  identity rather than `""`, because an empty JSON key is unreadable in a diff. */
const COLORS = ["W", "U", "B", "R", "G"] as const;

export function identityKey(colorIdentity: string[]): string {
  const set = new Set(colorIdentity.map((c) => c.toUpperCase()));
  const key = COLORS.filter((c) => set.has(c)).join("");
  return key === "" ? "C" : key;
}

export type AnswerPool = Record<string, Record<string, number>>;

/** IMPORTED RATHER THAN READ FROM DISK so the analysis path bundles for a browser (roadmap P2).
 *  The cache went with the read -- there is nothing left to cache. */
export function loadAnswerPool(): AnswerPool {
  return pool as AnswerPool;
}

/** How much of the format's answer supply for this class is legal in this identity, as a share of
 *  the five-colour maximum. A mono-black deck's artifact share is ~0.07: black really does have
 *  almost no artifact removal, and the score must not read that as a deckbuilding failure.
 *
 *  AN UNKNOWN CLASS OR IDENTITY RETURNS 1, NEVER 0. A missing row means "we do not know", and a 0
 *  would silently drop the class out of the coverage denominator -- the same silent-fallback defect
 *  `gatedLandsTarget` was rejected in review for. */
export function poolShare(colorIdentity: string[], cls: string): number {
  const pool = loadAnswerPool();
  const row = pool[identityKey(colorIdentity)];
  const max = pool.WUBRG?.[cls];
  if (!row || row[cls] === undefined || !max) return 1;
  return row[cls] / max;
}

/** The union of the COMMANDERS' colour identities (CR 903.4) -- never the deck's other 99 cards.
 *  `undefined` when no name in `commanders` matched an actual card in `deck`: a requested name that
 *  resolved to nothing must leave identity absent, not fall back to an empty/colourless identity
 *  that would silently understate every pool (Task 4's lesson, the design's own §3).
 *
 *  ONE HELPER, NOT TWO COPIES (whole-branch review MINOR 1) -- `analyze.ts` and `deck-math.ts` each
 *  carried this identical four-line derivation, and a drift between them would mean the panel's
 *  `pool` row and the score's `poolShare` describe two different colour identities for the same
 *  deck: the panel/score disagreement class this branch already closed twice. */
export function commanderIdentity(
  deck: readonly DeckCard[],
  commanders: ReadonlySet<string> | readonly string[],
): string[] | undefined {
  const names = commanders instanceof Set ? commanders : new Set(commanders);
  const commanderCards = deck.filter((dc) => names.has(dc.card.name));
  return commanderCards.length
    ? [...new Set(commanderCards.flatMap((dc) => dc.card.colorIdentity ?? []))]
    : undefined;
}
