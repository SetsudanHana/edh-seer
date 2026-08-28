import { globalIDF, type Reason, type TagStats } from "@edh-seer/engine";

/** Extra TF mass given to the commander's own theme tags so the commander anchors the axis —
 *  but the weight is still × globalIDF, so a generic commander ability (near-zero idf) can't
 *  define the plan. Tunable starting point (calibrated on real decks). */
export const COMMANDER_TF_BOOST = 8;

/** The deck's strategy axis as a tag→weight map, weighting each theme by TF-IDF: deckFreq
 *  (repetition = intent) × globalIDF (rarity = distinctiveness), normalized so the deck's
 *  strongest theme is 1.0. Universal tags (draw:any, enters:any) have idf≈0 and drop out.
 *  Keeps every tag with weight > 0; the on-axis cutoff is applied by the caller's predicate. */
export function buildAxis(
  commanderThemeTags: Set<string>,
  deckFreq: Map<string, number>,
  stats: TagStats,
): Map<string, number> {
  const tfidf = new Map<string, number>();
  for (const [tag, freq] of deckFreq) {
    const tf = freq + (commanderThemeTags.has(tag) ? COMMANDER_TF_BOOST : 0);
    const w = tf * globalIDF(stats, tag);
    if (w > 0) tfidf.set(tag, w);
  }
  const max = Math.max(0, ...tfidf.values());
  const axis = new Map<string, number>();
  if (max > 0) for (const [tag, w] of tfidf) axis.set(tag, w / max);
  return axis;
}

/** The strongest axis weight among an edge's reason tags (0 when none are on-axis). */
export function maxAxisWeight(reasons: Reason[], axis: Map<string, number>): number {
  let maxW = 0;
  for (const r of reasons) {
    const w = axis.get(r.tag) ?? 0;
    if (w > maxW) maxW = w;
  }
  return maxW;
}

/** Multiplier for an edge's contribution: 1 when it touches nothing on-axis, up to 1+boost when a
 *  reason is fully on-axis. Uses the strongest on-axis reason. */
export function axisFactor(reasons: Reason[], axis: Map<string, number>, boost: number): number {
  return 1 + boost * maxAxisWeight(reasons, axis);
}
