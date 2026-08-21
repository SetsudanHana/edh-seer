import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

let cached: AnswerPool | undefined;

export function loadAnswerPool(): AnswerPool {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  cached = JSON.parse(readFileSync(join(here, "answer-pool.json"), "utf8")) as AnswerPool;
  return cached;
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
