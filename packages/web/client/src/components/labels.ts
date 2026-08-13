export interface LabelBox { id: string; x: number; y: number; w: number; h: number }

/** Greedy, priority-ordered, screen-space. Input MUST already be in priority order; the first
 *  label to claim a region keeps it.
 *
 *  Greedy and order-dependent ON PURPOSE. An optimiser that maximised label count would change its
 *  answer as the camera moved, so labels would pop in and out during a smooth zoom. Stability of
 *  the reveal beats density of it. */
export function placeLabels(boxes: readonly LabelBox[]): string[] {
  const placed: LabelBox[] = [];
  const out: string[] = [];
  for (const b of boxes) {
    const hits = placed.some((p) =>
      b.x < p.x + p.w && p.x < b.x + b.w && b.y < p.y + p.h && p.y < b.y + b.h);
    if (hits) continue;
    placed.push(b);
    out.push(b.id);
  }
  return out;
}

/** Commander first, then weighted degree, then the hovered neighbourhood, then everything else.
 *  Ties broken by name so the order is stable between frames. */
export function labelPriority(
  nodes: readonly { id: string }[],
  weightedDegree: Map<string, number>,
  commanders: ReadonlySet<string>,
  hovered: ReadonlySet<string>,
): string[] {
  const rank = (id: string): number =>
    commanders.has(id) ? 0 : hovered.has(id) ? 1 : 2;
  return [...nodes]
    .sort((a, b) =>
      rank(a.id) - rank(b.id) ||
      (weightedDegree.get(b.id) ?? 0) - (weightedDegree.get(a.id) ?? 0) ||
      a.id.localeCompare(b.id))
    .map((n) => n.id);
}
