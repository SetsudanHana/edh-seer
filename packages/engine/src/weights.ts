import { describeTag, type Tag } from "./tags.js";

export interface TagStats {
  N: number;
  counts: Record<string, number>;
}

export interface Cohesion {
  /** describeTag of the primary theme tag. */
  theme: string;
  tag: Tag;
  /** describeTag of the secondary theme, or null when the deck has only one theme. */
  secondary: string | null;
  secondaryTag: Tag | null;
  /** Share of nonland cards touching the primary theme, in [0,1]. */
  score: number;
  label: string;
}

export const COMBO_EDGE_WEIGHT = 1000;

/** Geometric decay applied per theme rank: weight = THEME_DECAY^(rank-1). */
export const THEME_DECAY = 2 / 3;

export function globalIDF(stats: TagStats, tag: Tag): number {
  const count = stats.counts[tag] ?? 0;
  return Math.log((stats.N + 1) / (count + 1));
}

/**
 * Order a deck's tags into themes: descending by deckFreq × globalIDF, so a tag that
 * is both dense in the deck AND rare in the corpus (a real theme) outranks a dense-but-
 * common staple (mana) or a rare-but-incidental one-off. Deterministic lexical tie-break.
 */
export function rankThemes(deckFreq: Map<Tag, number>, stats: TagStats): Tag[] {
  return [...deckFreq.entries()]
    .map(([tag, freq]) => ({ tag, key: freq * globalIDF(stats, tag) }))
    .sort((a, b) => b.key - a.key || a.tag.localeCompare(b.tag))
    .map((r) => r.tag);
}

/** Map each deck tag to its theme weight THEME_DECAY^(rank-1) (rank 1 = weight 1). */
export function themeWeights(deckFreq: Map<Tag, number>, stats: TagStats): Map<Tag, number> {
  const weights = new Map<Tag, number>();
  rankThemes(deckFreq, stats).forEach((tag, i) => weights.set(tag, Math.pow(THEME_DECAY, i)));
  return weights;
}

/** Sum theme weights over DISTINCT reason tags; a combo edge is a large constant. */
export function weightedEdge(reasons: { tag: string }[], weightOf: (tag: string) => number): number {
  if (reasons.some((r) => r.tag === "combo")) return COMBO_EDGE_WEIGHT;
  const seen = new Set<string>();
  let sum = 0;
  for (const r of reasons) {
    if (seen.has(r.tag)) continue;
    seen.add(r.tag);
    sum += weightOf(r.tag);
  }
  return sum;
}

/** Damped weighted sum: rewards on-theme breadth while tempering wide hubs. */
export function dampedScore(totalWeighted: number, partnerCount: number): number {
  return partnerCount > 0 ? totalWeighted / Math.sqrt(partnerCount) : 0;
}

export function cohesionLabel(score: number): string {
  if (score >= 0.6) return "highly focused";
  if (score >= 0.3) return "focused";
  return "unfocused";
}

/**
 * Cohesion from the ranked themes: names the primary (and secondary) theme and scores
 * how much of the deck sits on the primary theme (share of nonland cards carrying it).
 */
export function computeCohesion(
  ranked: Tag[],
  deckFreq: Map<Tag, number>,
  nonlandCount: number,
): Cohesion | null {
  if (ranked.length === 0 || nonlandCount === 0) return null;
  const primary = ranked[0];
  const secondary = ranked[1] ?? null;
  const score = Math.min(1, (deckFreq.get(primary) ?? 0) / nonlandCount);
  return {
    theme: describeTag(primary),
    tag: primary,
    secondary: secondary ? describeTag(secondary) : null,
    secondaryTag: secondary,
    score,
    label: cohesionLabel(score),
  };
}
