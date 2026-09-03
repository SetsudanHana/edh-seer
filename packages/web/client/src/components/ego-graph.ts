import type { CardGraph } from "../types.js";
import { computeFlow, type FlowOptions } from "./flow.js";

/** THE ONE-HOP NEIGHBOURHOOD OF ONE CARD, AS A GRAPH IN ITS OWN RIGHT.
 *
 *  This is the "Show Context" step of Search -> Show Context -> Expand on Demand (van Ham & Perer,
 *  TVCG 2009): on a phone the whole-deck cloud cannot be drawn at a size a thumb can hit -- the 24px
 *  floor is crossed at ~36 nodes and every deck here is 73-100 -- so the reader is given one card's
 *  context instead of everything.
 *
 *  NO NEW ALGORITHM. `computeFlow` already walks exactly one hop, caps each direction at
 *  FLOW_FANOUT_CAP by descending weight, and reports what it truncated. This projects that flow back
 *  into a `CardGraph` so `GraphView` can draw it with no idea it is looking at a subset.
 *
 *  ONE HOP IS AN OWNER RULING, not a size compromise -- see `computeFlow`'s own comment: at two hops
 *  a neighbour brings its own fan, so the view shows relationships between two cards the reader
 *  never asked about. Expansion is re-rooting on a neighbour, which is one tap.
 */
export function egoGraph(graph: CardGraph, focusId: string, opts: FlowOptions = {}): CardGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const focus = byId.get(focusId);
  // A focus that is not in this graph yields nothing rather than a graph of one invented node --
  // a silent wrong answer is worse than a missing one.
  if (!focus) return { ...graph, nodes: [], edges: [] };

  const flow = computeFlow(graph.edges, [focusId], opts);

  // Strongest first, so the ORDER carries the ranking even before the layout does -- and so a
  // reader who expands sees the same ordering the panel lists.
  const strength = new Map<string, number>();
  for (const e of graph.edges) {
    for (const [self, other] of [[e.from, e.to], [e.to, e.from]] as const) {
      if (self !== focusId) continue;
      strength.set(other, Math.max(strength.get(other) ?? 0, e.weight));
    }
  }
  const neighbours = [...flow.nodes.keys()]
    .filter((id) => byId.has(id))
    .sort((a, b) => (strength.get(b) ?? 0) - (strength.get(a) ?? 0) || a.localeCompare(b));

  const keep = new Set([focusId, ...neighbours]);
  return {
    ...graph,
    nodes: [focus, ...neighbours.map((id) => byId.get(id)!)],
    // `flow.edges` records an edge even when the card on the other end was over budget, so filter on
    // the node set rather than trusting it -- an edge to a node we did not keep would draw to
    // nowhere. The `focusId` term is what keeps this ONE hop: two neighbours may well have an edge
    // between them, and drawing it would be the two-hop view the owner refused.
    edges: graph.edges.filter(
      (e) => keep.has(e.from) && keep.has(e.to) && (e.from === focusId || e.to === focusId),
    ),
  };
}
