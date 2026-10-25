/** HOW A CARD'S SIMILAR LIST RIDES IN ITS PARTNER SHARD ENTRY (#1341), and nothing else.
 *
 *  A ROW IS `[position in the name index, tier code, ...chip codes]`: the candidate is read off the name
 *  index the page already loads (slug, name), and a chip is a position in ONE table shipped in
 *  `name-index.json` as `similarChips`, because the same few hundred labels ("+ protection", "your
 *  creatures") repeat across every list. PURE and import-light: the browser decodes, the build encodes. */
import type { Chip, ChipDim, SimilarHit, SimilarTier } from "./similar.js";

export type SimilarRow = [number, number, ...number[]];
export interface SimilarItem { name: string; slug: string; tier: SimilarTier; chips: Chip[] }

/** The index IS the wire code: append only, never reorder, so a shard row built before a tier existed still decodes. */
const TIERS: readonly SimilarTier[] = ["same", "close", "output", "outcome"];

/** Interns chips in first-use order; `chips` is what ships, as `[dim, label]` pairs. */
export class ChipTable {
  readonly chips: [ChipDim, string][] = [];
  private readonly at = new Map<string, number>();
  code(c: Chip): number {
    const k = `${c.dim}\u0000${c.label}`;
    let i = this.at.get(k);
    if (i === undefined) { i = this.chips.length; this.chips.push([c.dim, c.label]); this.at.set(k, i); }
    return i;
  }
}

/** `hits[].id` IS the position in the name index. */
export function encodeSimilar(hits: readonly SimilarHit[], table: ChipTable): SimilarRow[] {
  return hits.map((h) => [h.id, TIERS.indexOf(h.tier), ...h.chips.map((c) => table.code(c))] as SimilarRow);
}

/** An absent list (a shard built before this shipped) is empty. A row whose candidate or chip the
 *  tables cannot name is dropped rather than shown wrong: the page lists fewer, never a guess. */
export function decodeSimilar(
  rows: readonly SimilarRow[] | undefined,
  index: readonly { slug: string; name: string }[],
  chips: readonly (readonly [string, string])[],
): SimilarItem[] {
  const out: SimilarItem[] = [];
  for (const [pos, tier, ...codes] of rows ?? []) {
    const e = index[pos];
    const t = TIERS[tier];
    if (!e || !t) continue;
    const cs = codes.map((c) => chips[c]);
    if (cs.some((c) => !c)) continue;
    out.push({ name: e.name, slug: e.slug, tier: t, chips: cs.map((c) => ({ dim: c![0] as ChipDim, label: c![1] })) });
  }
  return out;
}
