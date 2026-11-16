import relationStats from "../relation-stats.json" with { type: "json" };
import type { TagStats } from "@edh-seer/engine";
import { isOwnThemeTag } from "./axis.js";

/** THE CROSS-DECK RARITY OF THE OWN-THEME RELATION TAGS (#1095, owner ruling 2026-11-16): `N` decks, and
 *  `counts[tag]` = how many of them had at least one reason with that tag. It is a `TagStats`, so
 *  `globalIDF` reads it exactly as it reads `theme-stats.json`: an absent tag clamps to the rarest
 *  observed one, not to the unreachable `log(N+1)`.
 *
 *  CEILING: over the 71 calibration decks, not the corpus, and counted per reason tag, so a rare subject
 *  (most of them) rests on one or two decks and a tag the decks never showed clamps to the rarest observed.
 *  Why decks: a relation exists between two cards of one deck, so "how many decks have it" is the one population a pair statistic can be counted over without the
 *  O(n^2) pair search of the whole card pool. `deriveVersion` is the DERIVE_VERSION the file was
 *  generated at; `relation-stats.test.ts` fails until `npm run gen:relation-stats -w @edh-seer/matcher`
 *  is re-run after a bump. */
export interface RelationStats extends TagStats { deriveVersion: number }

/** Count decks per own-theme tag. Pure: the bin script feeds it each deck's reason tags. */
export function computeRelationStats(decks: Iterable<Iterable<string>>, deriveVersion: number): RelationStats {
  const counts: Record<string, number> = {};
  let n = 0;
  for (const tags of decks) {
    n++;
    for (const tag of new Set(tags)) if (isOwnThemeTag(tag)) counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return { N: n, counts: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))), deriveVersion };
}

/** The committed relation-stats.json, imported (not read from disk) so the analysis path bundles for a browser. */
export function loadRelationStats(): RelationStats {
  return relationStats as RelationStats;
}
