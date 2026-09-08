import { slugOf } from "@edh-seer/matcher/partners-core";
import type { NameIndexEntry } from "./partners.js";

/** ONE MATCHING RULE, read by the header field and the Cards page alike (spec 2026-09-08 part 1).
 *
 *  It was inline in `CardSearch` for the page alone; a second copy in the header is the two
 *  drifting about what a query means. Substring on the slug, because that is what `slugOf` already
 *  folds a name to, and it is the fold the artifact's slugs were minted with. */
export interface NameQuery {
  query: string;
  /** Only entries that can lead a deck. */
  commanders?: boolean;
  /** Exact colour identity: same letters, no more. `["C"]` is colourless. Empty means any. */
  colours?: string[];
}

export const needleOf = (query: string): string => slugOf(query.trim());

export function matchNames(index: NameIndexEntry[], q: NameQuery, limit?: number): NameIndexEntry[] {
  const needle = needleOf(q.query);
  const colours = q.colours ?? [];
  // Nothing asked is nothing answered: an empty needle would match every slug.
  if (needle.length === 0 && colours.length === 0) return [];
  const chosen = new Set(colours);
  const out: NameIndexEntry[] = [];
  for (const e of index) {
    if (q.commanders && !e.commander) continue;
    if (!e.slug.includes(needle)) continue;
    // THE COLOURS NAME THE IDENTITY EXACTLY (owner ruling 2026-09-04). "Red, Green" asks for Gruul
    // commanders -- not the ones that merely CONTAIN Gruul, and not the ones a Gruul deck could lead
    // with. Two wider rules were tried on the Commanders page and are both wrong there: a subset
    // ceiling answered every multi-colour question with mostly mono-coloured cards; a contains-all
    // buried Gruul under the Jund, Naya and five-colour commanders that also have both. Colourless
    // is the same question with an empty set, which is why `C` is exclusive.
    if (colours.length > 0) {
      const fits = chosen.has("C")
        ? e.identity.length === 0
        : e.identity.length === colours.length && colours.every((c) => e.identity.includes(c));
      if (!fits) continue;
    }
    out.push(e);
    if (limit !== undefined && out.length >= limit) break;
  }
  return out;
}
