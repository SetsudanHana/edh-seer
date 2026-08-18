import { tagFamily } from "@mtg/engine";
import type { Hierarchy } from "./types.js";

/** THE THEME FOLD — a deck's identity is the family, not its largest fragment.
 *
 *  Measured on a real deck (owner's Samut list, 2026-08-18): 79 distinct theme tags, with "make
 *  tokens" split across **22 `create-token:<subtype>` keys** — saproling 3, human 3, warrior 2,
 *  citizen 2, beast 2, goblin 2, elephant 1, kithkin 1, moogle 1, squirrel 1 … Folded to the verb
 *  those are **create-token 34 and enters 60** of roughly 63 nonlands. Ranking folds only a tag's
 *  literal `:any` sibling (`weights.ts`), so the deck's primary theme was a **3-card fragment**,
 *  cohesion read 3/63 = 0.05 "unfocused", and the axis those numbers are built from was anchored on
 *  the fragment — which is why most of a plainly-focused token deck rated as off-theme.
 *
 *  THIS IS A READ-TIME FOLD AND NEVER A RE-KEY. `themeSubjectKey` is untouched: the frozen panel
 *  keys its cached verdicts on `producer|consumer|tag`, and the last attempt to compose extra facts
 *  into that key cost 22 judging debt while not changing a single theme. Claims keep their exact
 *  identity; only the three readers that ask "what is this deck about" fold.
 *
 *  FAMILIES THAT MUST NOT FOLD, each for its own reason:
 *   - `tribe:` / `tribe-nontoken:` — the tribe IS the theme. Folding `tribe:wizard` into
 *     `tribe:creature` is precisely the regression 38e5248 fixed, where five tribal decks stopped
 *     naming their tribe.
 *   - `static:` — its value is an effect KIND (`static:pump`), not a subject. `pump` is not a
 *     subtype, so the hierarchy test already declines it; the family is listed anyway so a future
 *     subtype-shaped kind cannot silently start folding.
 *   - `counter:` — the value is a counter kind (`+1/+1`), not a creature type. */
const NEVER_FOLD: ReadonlySet<string> = new Set(["tribe", "tribe-nontoken", "static", "counter"]);

/** Card types, in the order a multi-type subtype resolves. A subtype belonging to several card
 *  types (Kindred rows put creature types on non-creatures) picks the first match here so the fold
 *  is deterministic across runs rather than dependent on `hierarchy.json` ordering. */
const TYPE_PRIORITY = ["creature", "land", "artifact", "enchantment", "planeswalker", "battle", "instant", "sorcery"];

/** Maps a theme tag to the family key it should be COUNTED under. Returns the tag unchanged when it
 *  is already general (`enters:any`), when its value is a card type rather than a subtype
 *  (`enters:creature`), when the family never folds, or when the value is a negation/umbrella the
 *  hierarchy cannot resolve. */
export function foldThemeTag(tag: string, h: Hierarchy): string {
  const family = tagFamily(tag);
  if (family === tag || NEVER_FOLD.has(family)) return tag;
  const value = tag.slice(family.length + 1);
  if (value === "any" || value.startsWith("-")) return tag;
  const parents = h[value.toLowerCase()];
  if (!parents || parents.length === 0) return tag;
  const parent = TYPE_PRIORITY.find((t) => parents.includes(t)) ?? parents[0];
  return `${family}:${parent}`;
}

/** A fold function bound to one hierarchy, for the readers that take it as an argument. */
export type FoldTag = (tag: string) => string;
export const makeFold = (h: Hierarchy): FoldTag => (tag) => foldThemeTag(tag, h);

/** Identity fold — what the readers use when no hierarchy is supplied, so behaviour is unchanged
 *  for every caller that does not opt in. */
export const NO_FOLD: FoldTag = (tag) => tag;

/** How much of a family one child must hold to NAME the family. Below it the family is named by its
 *  own key, so a 22-way token split reads "creates tokens" while a Wizards deck holding 25 of 30
 *  `enters:*` in `enters:wizard` still reads "Wizards".
 *
 *  Seeded at 0.5 and MEASURED across the 71 calibration decks before it was kept — see the design
 *  note in the commit. A share test, not a count test: a 3-of-5 family is as dominated as 30-of-50. */
export const DOMINANT_SHARE = 0.5;

/** Group a deck's tags into folded families, each carrying the child that should name it.
 *  `freq` decides dominance; ties break on the tag string so the choice is stable. */
export function foldFamilies(
  deckFreq: ReadonlyMap<string, number>,
  fold: FoldTag,
): Map<string, { total: number; representative: string; members: string[] }> {
  const out = new Map<string, { total: number; representative: string; members: string[] }>();
  for (const [tag, freq] of deckFreq) {
    const key = fold(tag);
    const g = out.get(key) ?? { total: 0, representative: key, members: [] };
    g.total += freq;
    g.members.push(tag);
    out.set(key, g);
  }
  for (const [key, g] of out) {
    let best = "", bestFreq = -1;
    for (const m of g.members) {
      const f = deckFreq.get(m) ?? 0;
      if (f > bestFreq || (f === bestFreq && m < best)) { best = m; bestFreq = f; }
    }
    g.representative = bestFreq / g.total >= DOMINANT_SHARE ? best : key;
  }
  return out;
}
