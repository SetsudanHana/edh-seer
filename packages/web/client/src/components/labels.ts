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

/** Which nodes may carry a name label at this zoom — a FLOOR and a CEILING.
 *
 *  Below `zoomFloor` most of the board is too small on screen for a name to mean anything, so only
 *  commanders and whatever is under the pointer stay eligible.
 *
 *  At or above `cardModeZoom` the board draws whole cards, and a card's own art prints its name
 *  larger and better than a label can — so a label there is redundancy painted over the thing it
 *  duplicates. Only cards drawn as a PLACEHOLDER keep one: a placeholder is a blank coloured
 *  rectangle, and suppressing its name would leave nothing on screen identifying it.
 *
 *  A pure function, and separated from GraphView for the reason `traveledAsPan` is: jsdom cannot
 *  load an image, so every card there draws as a placeholder and the ceiling's real branch can
 *  never be reached through the component. The arithmetic is what is testable, not the render that
 *  produces its inputs. Paint only — no candidate set has ever fed layout. */
export function labelCandidates<T extends { id: string }>(
  nodes: readonly T[],
  z: number,
  opts: {
    zoomFloor: number;
    cardModeZoom: number;
    eligibleBelowFloor: ReadonlySet<string>;
    placeholders: ReadonlySet<string>;
  },
): T[] {
  if (z < opts.zoomFloor) return nodes.filter((n) => opts.eligibleBelowFloor.has(n.id));
  if (z >= opts.cardModeZoom) return nodes.filter((n) => opts.placeholders.has(n.id));
  return [...nodes];
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
