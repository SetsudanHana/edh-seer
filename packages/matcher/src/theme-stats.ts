import themeStats from "../theme-stats.json" with { type: "json" };
import type { TagStats } from "@edh-seer/engine";
import type { CardTags } from "@edh-seer/tagger";
import { cardThemeTags } from "./edges.js";

/** Empty corpus stats: globalIDF degrades to a constant, so the axis falls back to the old
 *  undiscriminating (deckFreq-only) behavior rather than crashing when the artifact is absent. */
export const UNIFORM_STATS: TagStats = { N: 1, counts: {} };

/** Corpus document-frequency of every structured theme tag (cardThemeTags vocabulary). N = number
 *  of tagged cards; counts[tag] = how many carry it. Pure — the bin script feeds it Mongo docs. */
export function computeThemeStats(tagDocs: CardTags[]): TagStats {
  const counts: Record<string, number> = {};
  for (const tags of tagDocs) {
    for (const tag of cardThemeTags(tags)) counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return { N: tagDocs.length, counts };
}

/** The committed theme-stats.json, IMPORTED RATHER THAN READ FROM DISK so the analysis path bundles
 *  for a browser (roadmap P2).
 *
 *  The old `try`/`catch` fell back to `UNIFORM_STATS` when the file was unreadable; a static import
 *  makes an absent or malformed artifact a BUILD failure instead. That is the louder direction and
 *  it matters here specifically: an ABSENT tag scores the MAXIMUM idf, so a silently-degraded
 *  artifact does not weaken the ranking, it lets a missing tag WIN (measured 2026-08-18).
 *  `UNIFORM_STATS` is still exported and still the right value for a caller with no corpus. */
export function loadThemeStats(): TagStats {
  return themeStats as TagStats;
}
