import { describeTag, type Tag } from "./tags.js";

export interface TagStats {
  N: number;
  counts: Record<string, number>;
}

export interface Cohesion {
  theme: string;
  tag: string;
  score: number;
  label: string;
}

export const COMBO_EDGE_WEIGHT = 1000;

export function globalIDF(stats: TagStats, tag: Tag): number {
  const count = stats.counts[tag] ?? 0;
  return Math.log((stats.N + 1) / (count + 1));
}

export function density(deckFreq: number): number {
  return Math.sqrt(Math.max(deckFreq, 1));
}

export function tagWeight(stats: TagStats, tag: Tag, deckFreq: number): number {
  return globalIDF(stats, tag) * density(deckFreq);
}

/** Sum tagWeights over DISTINCT reason tags; a combo edge is a large constant. */
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

export function computeCohesion(deckFreq: Map<Tag, number>, stats: TagStats): Cohesion | null {
  if (deckFreq.size === 0) return null;
  let domTag: Tag | null = null;
  let domRank = -Infinity;
  let domFreq = -1;
  let domWeight = 0;
  let total = 0;
  for (const [tag, freq] of deckFreq) {
    const w = tagWeight(stats, tag, freq);
    total += w;
    const rank = freq * globalIDF(stats, tag);
    const better =
      rank > domRank ||
      (rank === domRank && freq > domFreq) ||
      (rank === domRank && freq === domFreq && domTag !== null && tag < domTag);
    if (better) {
      domTag = tag;
      domRank = rank;
      domFreq = freq;
      domWeight = w;
    }
  }
  const t = domTag as Tag;
  const score = total > 0 ? domWeight / total : 0;
  return { theme: describeTag(t), tag: t, score, label: cohesionLabel(score) };
}
