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
    /** Weighted degree per node — the same map the priority order below reads — and the quantile of
     *  it a node must clear to stay eligible between the floor and card zoom. 0.25 culls the weakest
     *  quarter; 0.5 is the median.
     *
     *  THE TWO TRAVEL TOGETHER, and that is a type rather than a convention: the quantile decides
     *  how much of the board goes quiet, so a caller that passes the map and forgets the number
     *  would silently get some default's idea of it. Omit BOTH and nothing is culled, which is what
     *  this function did before 2026-08-28 and what every caller outside the board still wants. */
    cull?: { weightedDegree: ReadonlyMap<string, number>; degreeQuantile: number };
  },
): T[] {
  if (z < opts.zoomFloor) return nodes.filter((n) => opts.eligibleBelowFloor.has(n.id));
  if (z >= opts.cardModeZoom) return nodes.filter((n) => opts.placeholders.has(n.id));
  if (!opts.cull) return [...nodes];
  // THE BETTER-CONNECTED CARDS, AND WHATEVER THE READER IS POINTING AT.
  //
  // Between the floor and card zoom every node was eligible, so a 130-node board sent 130 names
  // into a greedy placer that then dropped most of them on collision — the reader got whichever
  // names happened to win a rectangle fight, and the loser was usually the card next to the one
  // they were reading. A review (2026-08-28) named this as the un-measured half of "the board is
  // cluttered": crossings had a metric and a cap, labels had neither.
  //
  // A QUANTILE, not a fixed count: a number of labels would be wrong at both ends (an 80-card board
  // and a 130-card one need different answers) while a share is the same claim at every size.
  // Weighted degree, not partner count, for the reason `weightedDegree` exists at all: an edge is
  // binary but synergy has magnitude, so a card with six weak partners must not outrank one with
  // two strong ones.
  //
  // MEASURED, and the cull bites HARDER than its share, which is the part worth knowing before
  // moving the number. Labels actually PLACED at zoom 1.2, five seeds (0.6em width approximation,
  // as in the placeLabels table above — read the ratios):
  //
  //    fixture   nodes   q=0 (before)   q=0.25 (ships)   q=0.5
  //    mdfc       130         61              32           14
  //    inalla      94         37              27           14
  //    sorin       84         39              18            9
  //
  // Cutting a QUARTER of the candidates costs about HALF the labels, because the cards it removes
  // are the weakly-connected ones out on the rim — which are exactly the ones with empty space
  // around them, so they were winning slots the dense middle can never win. The cull therefore
  // trades away labels that were legible to reduce the total count; at q=0.5 a 130-card board keeps
  // 14 names, which is nearly nothing. 0.25 is the setting that halves the text and still names
  // about a quarter of the board.
  //
  // Commanders and the hovered neighbourhood are never culled — they are the two sets the floor
  // below already exempts, and a board that hides the commander's name to save room has answered
  // the wrong question.
  const { weightedDegree, degreeQuantile } = opts.cull;
  const degrees = nodes.map((n) => weightedDegree.get(n.id) ?? 0).sort((a, b) => a - b);
  const bar = degrees.length === 0 ? 0 : degrees[Math.floor(degrees.length * degreeQuantile)]!;
  return nodes.filter((n) =>
    opts.eligibleBelowFloor.has(n.id) || (weightedDegree.get(n.id) ?? 0) >= bar);
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
