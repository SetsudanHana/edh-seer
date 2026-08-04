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

/** The mechanism half of a tag: everything before the first ":". Tags are `<verb>:<subject>`
 *  (`counter-added:creature`), and the same mechanism at two subject granularities is one theme,
 *  not two — a deck whose counters split 17/16 across `:creature` and `:any` was ranking below a
 *  single `draw:any` of 18, which is how a +1/+1 deck came to report "primary = draw". */
export function tagFamily(tag: string): string {
  const i = tag.indexOf(":");
  return i === -1 ? tag : tag.slice(0, i);
}

/**
 * Order a deck's tags into themes. Primary key is the tag's family (the mechanism before
 * ":"), summed across every subject that family appears at, so `counter-added:creature`
 * and `counter-added:any` rank as one combined theme instead of splitting and losing to a
 * single-subject tag like `draw:any`. Within a family, individual deckFreq × globalIDF
 * breaks the tie — dense AND rare wins over a dense-but-common staple (mana) or a
 * rare-but-incidental one-off — then lexical order for determinism.
 */
export function rankThemes(deckFreq: Map<Tag, number>, stats: TagStats): Tag[] {
  const scored = [...deckFreq.entries()]
    .map(([tag, freq]) => ({ tag, key: freq * globalIDF(stats, tag) }));

  // Rank by the family's combined weight so one mechanism counts once, but keep returning real
  // tags: callers (themeWeights, weightedEdge) look tags up directly and would miss a family name.
  const familyKey = new Map<string, number>();
  for (const s of scored) {
    const f = tagFamily(s.tag);
    familyKey.set(f, (familyKey.get(f) ?? 0) + s.key);
  }

  return scored
    .sort((a, b) => {
      const fa = familyKey.get(tagFamily(a.tag)) ?? 0;
      const fb = familyKey.get(tagFamily(b.tag)) ?? 0;
      // family strength first, then the member's own strength, then lexical for determinism
      return fb - fa || b.key - a.key || a.tag.localeCompare(b.tag);
    })
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
  // `tribe-nontoken:X` is a matching-precision shadow of `tribe:X`, not a distinct
  // theme — drop it from theme naming so cohesion reports "Wizards", not the
  // near-duplicate "nontoken Wizards". It still carries edge weight via rankThemes.
  const themes = ranked.filter((t) => !t.startsWith("tribe-nontoken:"));
  if (themes.length === 0 || nonlandCount === 0) return null;
  const primary = themes[0];
  // Secondary must be a different mechanism, not just the next tag: rankThemes' family
  // collapse now puts same-family tags adjacent (e.g. counter-added:creature next to
  // counter-added:any), and describeTag has no per-family case for most families, so a
  // same-family secondary would render the identical label as the primary.
  const secondary = themes.slice(1).find((t) => tagFamily(t) !== tagFamily(primary)) ?? null;
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
