import type { CardGraph } from "../types.js";

type Edge = CardGraph["edges"][number];

/** Edges kept per node, per hop, strongest first. MEASURED, not guessed: over all 71 calibration
 *  decks (6,224 node-directions on the projected graph), direct fan size runs p50 3 · p90 7 · p95 15
 *  · p99 41 · max 80. At 6 the cap truncates 10.5% of node-directions and the resulting flow has a
 *  worst case of 47 cards; at 8 it truncates 8.5% but the worst case is 59 -- half a 90-card board
 *  lit up, which is the outcome the cap exists to prevent. */
export const FLOW_FANOUT_CAP = 6;

/** Total cards a flow may draw, both fans together. A per-node cap cannot bound the tail on its own:
 *  six per node compounds across hops, which is why even a cap of 4 still reaches 37. BFS expands
 *  nearest-first, so this always cuts the FARTHEST ring -- the part of a chain with the weakest
 *  claim on attention. Binds on roughly the top 1% of clicks and never on a typical one (mean 7.7). */
export const FLOW_NODE_BUDGET = 40;

export interface FlowEdge { from: string; to: string; dir: "up" | "down"; depth: number }
export interface FlowNode { upstreamDepth?: number; downstreamDepth?: number }

export interface Flow {
  root: string;
  /** Every card in either fan, excluding the root. */
  nodes: Map<string, FlowNode>;
  edges: FlowEdge[];
  /** Cycles found while walking. Not rendered today; recorded so a later loop detector starts from
   *  data rather than a rediscovery (spec §7). */
  cycles: Array<{ nodes: string[]; edges: FlowEdge[] }>;
  /** Nodes whose fan was cut, and by how much. The UI states this rather than hiding it. */
  truncated: Map<string, { total: number; shown: number }>;
}

export interface FlowOptions { fanoutCap?: number; nodeBudget?: number }

/** The flow of events through one card: everything it feeds, and everything that feeds it.
 *
 *  TWO DIRECTION-PURE WALKS. Downstream follows `from -> to`; upstream follows `to -> from`; neither
 *  consults the other's adjacency. That is the whole feature: measured over six calibration decks, a
 *  walk allowed to turn around reaches 50-76% of a deck by depth 3, against 3-12% for a pure one. A
 *  path that goes forward then backward is not a flow anyway -- it says "these two share a
 *  neighbour", which is not a claim worth drawing. */
export function computeFlow(edges: readonly Edge[], rootId: string, opts: FlowOptions = {}): Flow {
  const fanoutCap = opts.fanoutCap ?? FLOW_FANOUT_CAP;
  const nodeBudget = opts.nodeBudget ?? FLOW_NODE_BUDGET;

  // A self-edge should not exist (edges.ts pairs distinct cards) but is dropped rather than trusted.
  const real = edges.filter((e) => e.from !== e.to);
  const down = new Map<string, Edge[]>();
  const up = new Map<string, Edge[]>();
  for (const e of real) {
    (down.get(e.from) ?? down.set(e.from, []).get(e.from)!).push(e);
    (up.get(e.to) ?? up.set(e.to, []).get(e.to)!).push(e);
  }

  const flow: Flow = {
    root: rootId,
    nodes: new Map(),
    edges: [],
    cycles: [],
    truncated: new Map(),
  };

  const walk = (adj: Map<string, Edge[]>, dir: "up" | "down"): void => {
    const seen = new Set<string>([rootId]);
    const parent = new Map<string, string>();
    let frontier = [rootId];
    let depth = 1;

    while (frontier.length > 0 && flow.nodes.size < nodeBudget) {
      const next: string[] = [];
      for (const id of frontier) {
        const all = adj.get(id) ?? [];
        const kept = [...all].sort((a, b) => b.weight - a.weight).slice(0, fanoutCap);
        if (all.length > kept.length) flow.truncated.set(id, { total: all.length, shown: kept.length });

        for (const edge of kept) {
          const other = dir === "down" ? edge.to : edge.from;
          const flowEdge: FlowEdge = { from: edge.from, to: edge.to, dir, depth };

          if (seen.has(other)) {
            // A cycle: this edge closes a loop back onto something already walked. Recorded rather
            // than dropped -- see the `cycles` doc comment.
            const loop: string[] = [other];
            for (let at: string | undefined = id; at !== undefined && at !== other; at = parent.get(at)) {
              loop.push(at);
            }
            flow.cycles.push({ nodes: loop, edges: [flowEdge] });
            continue;
          }
          if (flow.nodes.size >= nodeBudget) break;

          seen.add(other);
          parent.set(other, id);
          const node = flow.nodes.get(other) ?? {};
          if (dir === "down") node.downstreamDepth = depth;
          else node.upstreamDepth = depth;
          flow.nodes.set(other, node);
          flow.edges.push(flowEdge);
          next.push(other);
        }
      }
      frontier = next;
      depth++;
    }
  };

  walk(down, "down");
  walk(up, "up");
  return flow;
}
