import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { TagStats } from "@mtg/engine";
import type { CardTags } from "@mtg/tagger";
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

/** Read the committed theme-stats.json; fall back to UNIFORM_STATS if unreadable/absent. */
export function loadThemeStats(): TagStats {
  try {
    const path = join(dirname(fileURLToPath(import.meta.url)), "..", "theme-stats.json");
    return JSON.parse(readFileSync(path, "utf8")) as TagStats;
  } catch {
    return UNIFORM_STATS;
  }
}
