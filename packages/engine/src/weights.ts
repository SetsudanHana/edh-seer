import { describeTag, tagFamily, type Tag } from "./tags.js";

// Re-exported for callers that historically imported it from here (e.g. this file's own test)
// and for parity with globalIDF/rankThemes/etc. below — tagFamily itself now lives in tags.js,
// next to describeTag, the other tag-string-splitter.
export { tagFamily };

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
 * Order a deck's tags into themes. A tag's ranking strength is its own deckFreq × globalIDF,
 * plus its `:any` sibling's strength when the deck also has one — subsumption of a specific
 * subject by the general form of the same mechanism (`counter-added:creature` picks up
 * `counter-added:any`), so a deck whose counters split 17/16 across `:creature` and `:any`
 * still outranks a single `draw:any` of 18. `:any` never folds a second copy of itself. Two
 * DIFFERENT subjects of the same verb — `tribe:wizard` vs `tribe:goblin`, `static:pump` vs
 * `static:cost-reduction` — are different themes and are NEVER summed; only the literal `:any`
 * tag folds. Within that, individual deckFreq × globalIDF breaks the tie — dense AND rare wins
 * over a dense-but-common staple (mana) or a rare-but-incidental one-off — then lexical order
 * for determinism.
 */
export function rankThemes(deckFreq: Map<Tag, number>, stats: TagStats): Tag[] {
  const scored = [...deckFreq.entries()]
    .map(([tag, freq]) => ({ tag, key: freq * globalIDF(stats, tag) }));
  const keyByTag = new Map(scored.map((s) => [s.tag, s.key]));

  // Subsumption key: a tag's own strength, plus its ":any" sibling's strength if the deck has
  // one. NOT the whole family's sum — `tribe:goblin` gets no credit from `tribe:wizard`, and
  // `:any` doesn't add a second copy of itself.
  const subsumedKey = (tag: string): number => {
    const anyTag = `${tagFamily(tag)}:any`;
    const own = keyByTag.get(tag) ?? 0;
    return anyTag === tag ? own : own + (keyByTag.get(anyTag) ?? 0);
  };

  return scored
    .sort((a, b) => {
      const fa = subsumedKey(a.tag);
      const fb = subsumedKey(b.tag);
      // subsumed strength first, then the tag's own strength, then lexical for determinism
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
  // Secondary must be a different mechanism, not just the next tag: rankThemes only folds a
  // tag's own weight with its literal ":any" sibling (subsumption), so a same-family pair like
  // counter-added:creature / counter-added:any is not guaranteed to be adjacent in `ranked` —
  // but describeTag has no per-family case for most families, so a same-family secondary would
  // still render the identical label as the primary. Comparing family, not position, catches
  // that wherever in the ranking it falls.
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
