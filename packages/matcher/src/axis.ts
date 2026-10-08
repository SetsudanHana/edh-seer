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

/** Relation families (reason tags that are never on the axis) and the axis themes they feed.
 *  `fodder:X` feeds the deck's sacrifice/death theme on X; `scales:X` grows with the board of X;
 *  `cheat:X` puts X onto the battlefield; `creates:X` makes X. Step 1 of #972. */
export const RELATION_PARENTS: Record<string, readonly string[]> = {
  fodder: ["sacrifice", "dies"],
  scales: ["enters", "create-token"],
  cheat: ["enters"],
  creates: ["create-token", "enters"],
};

/** One tag's axis weight: its own entry if present (an explicit entry always wins), else the
 *  strongest parent-theme weight for a mapped relation family, else 0. */
export function axisWeightOf(tag: string, axis: Map<string, number>): number {
  const own = axis.get(tag);
  if (own !== undefined) return own;
  const i = tag.indexOf(":");
  if (i < 0) return 0;
  const parents = Object.hasOwn(RELATION_PARENTS, tag.slice(0, i)) ? RELATION_PARENTS[tag.slice(0, i)] : undefined;
  if (!parents) return 0;
  const subject = tag.slice(i + 1);
  let w = 0;
  for (const p of parents) w = Math.max(w, axis.get(`${p}:${subject}`) ?? 0);
  return w;
}

/** The strongest axis weight among an edge's reason tags (0 when none are on-axis). */
export function maxAxisWeight(reasons: Reason[], axis: Map<string, number>): number {
  let maxW = 0;
  for (const r of reasons) {
    const w = axisWeightOf(r.tag, axis);
    if (w > maxW) maxW = w;
  }
  return maxW;
}

/** Multiplier for an edge's contribution: 1 when it touches nothing on-axis, up to 1+boost when a
 *  reason is fully on-axis. Uses the strongest on-axis reason. */
export function axisFactor(reasons: Reason[], axis: Map<string, number>, boost: number): number {
  return 1 + boost * maxAxisWeight(reasons, axis);
}
