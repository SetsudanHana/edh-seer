export interface LabelBox { id: string; x: number; y: number; w: number; h: number }

const overlaps = (a: LabelBox, b: LabelBox): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** One label's candidate positions, best first. Today that is [above the node, below it].
 *  `slot` is the index that won, so the renderer draws where the pass actually placed it. */
export interface PlacedLabel { id: string; slot: number }

/** Greedy, priority-ordered, screen-space. Input MUST already be in priority order; the first
 *  label to claim a region keeps it.
 *
 *  Greedy and order-dependent ON PURPOSE. An optimiser that maximised label count would change its
 *  answer as the camera moved, so labels would pop in and out during a smooth zoom. Stability of
 *  the reveal beats density of it.
 *
 *  `obstacles` ARE THE NODES THEMSELVES, and leaving them out is what made the densest part of the
 *  board its least readable (roadmap H7). This pass only ever compared a label against other
 *  LABELS, so labels never collided with each other and freely covered neighbouring card ART —
 *  "March of the Multitudes" printed across the card beside it, three such collisions in one
 *  screenshot. A label is skipped when it hits any obstacle that is not its own node: a label sits
 *  directly above its own disc, and clipping against that would suppress every label on the board.
 *
 *  EACH LABEL GETS SEVERAL SLOTS, because obstacles alone cost too much. Measured over the five
 *  fixtures settled at 4,000 ticks, surviving labels against the no-obstacle pass:
 *
 *    fixture      zoom   before   obstacles only   + a below slot
 *    inalla        0.7     37       9 (24%)         13 (35%)
 *    inalla        1.6     74      25 (34%)         40 (54%)
 *    fairdrazi     0.7     31       7 (23%)         11 (35%)
 *    sorin         1.0     52      27 (52%)         31 (60%)
 *    braids        1.0     50      25 (50%)         35 (70%)
 *    changelings   0.7     64      52 (81%)         61 (95%)
 *
 *  (Widths there are a 0.6em monospace approximation — node has no canvas metrics — so read the
 *  ratios, not the absolute counts.) Trying below before giving up recovers 10-20 points on every
 *  fixture for one extra rectangle test per blocked label. The dense boards still lose labels, and
 *  that is the honest trade: a name printed across a neighbour's art is not a label, it is damage
 *  to two cards at once. */
export function placeLabels(
  slots: readonly (readonly LabelBox[])[],
  obstacles: readonly LabelBox[] = [],
): PlacedLabel[] {
  const placed: LabelBox[] = [];
  const out: PlacedLabel[] = [];
  for (const candidates of slots) {
    for (let slot = 0; slot < candidates.length; slot++) {
      const b = candidates[slot]!;
      if (placed.some((p) => overlaps(b, p))) continue;
      if (obstacles.some((o) => o.id !== b.id && overlaps(b, o))) continue;
      placed.push(b);
      out.push({ id: b.id, slot });
      break;
    }
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
