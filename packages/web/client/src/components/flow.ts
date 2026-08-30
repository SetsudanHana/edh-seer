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
  /** EVERY CARD THE READER HAS SELECTED, not one. Selection is additive: clicking a second card
   *  adds its fans to the first card's rather than replacing them, so a reader can build a path up
   *  one card at a time and take it apart the same way. A single click is just the one-root case. */
  roots: ReadonlySet<string>;
  /** Every card in either fan, excluding the roots. */
  nodes: Map<string, FlowNode>;
  edges: FlowEdge[];
  /** Cycles found while walking. Not rendered today; recorded so a later loop detector starts from
   *  data rather than a rediscovery (spec §7). */
  cycles: Array<{ nodes: string[]; edges: FlowEdge[] }>;
  /** Nodes whose fan was cut, and by how much -- keyed by direction as well as id, since a card can
   *  sit as the root of BOTH walks at once and each has its own fanout to report. Keying by id alone
   *  let the upstream walk's entry silently overwrite the downstream walk's for the root, so "feeds
   *  10, shown 6" printed as "8 in total" when the same root also had 8 upstream. */
  truncated: Map<string, { up?: { total: number; shown: number }; down?: { total: number; shown: number } }>;
}

export interface FlowOptions { fanoutCap?: number; nodeBudget?: number }

/** The flow of events through the selected cards: everything they feed, and everything that feeds
 *  them.
 *
 *  TWO DIRECTION-PURE WALKS. Downstream follows `from -> to`; upstream follows `to -> from`; neither
 *  consults the other's adjacency. That is the whole feature: measured over six calibration decks, a
 *  walk allowed to turn around reaches 50-76% of a deck by depth 3, against 3-12% for a pure one. A
 *  path that goes forward then backward is not a flow anyway -- it says "these two share a
 *  neighbour", which is not a claim worth drawing. */
export function computeFlow(edges: readonly Edge[], rootIds: readonly string[], opts: FlowOptions = {}): Flow {
  const roots = new Set(rootIds);
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
    roots,
    nodes: new Map(),
    edges: [],
    cycles: [],
    truncated: new Map(),
  };

  const walk = (adj: Map<string, Edge[]>, dir: "up" | "down"): void => {
    // ONE WALK FROM ALL ROOTS AT ONCE, not one walk per root merged afterwards, and the difference
    // is the budget: merging N per-root flows would light up to N x FLOW_NODE_BUDGET cards, so the
    // fourth click could put 160 nodes on a 100-card board. A shared frontier expands nearest-first
    // across every root together, so the budget still cuts the farthest ring — which is the part of
    // any chain with the weakest claim on attention, whichever root it hangs off.
    const seen = new Set<string>(roots);
    const parent = new Map<string, string>();
    let frontier = [...roots];
    let depth = 1;

    while (frontier.length > 0 && flow.nodes.size < nodeBudget) {
      const next: string[] = [];
      for (const id of frontier) {
        const all = adj.get(id) ?? [];
        const kept = [...all].sort((a, b) => b.weight - a.weight).slice(0, fanoutCap);
        if (all.length > kept.length) {
          const entry = flow.truncated.get(id) ?? {};
          entry[dir] = { total: all.length, shown: kept.length };
          flow.truncated.set(id, entry);
        }

        for (const edge of kept) {
          const other = dir === "down" ? edge.to : edge.from;
          const flowEdge: FlowEdge = { from: edge.from, to: edge.to, dir, depth };

          if (seen.has(other)) {
            // Still a genuine direction-pure edge between two nodes already in this fan (e.g.
            // A->B, A->C, B->C: B->C reaches C, already seen via A->C) -- draw it before deciding
            // whether it ALSO closes a loop. Dropping it here used to silently erase a real edge
            // between two lit cards.
            flow.edges.push(flowEdge);
            // A cycle only when `other` is an ANCESTOR of `id` on this walk -- i.e. walking `id`'s
            // parent chain actually reaches `other`. A node reached a second time via a sibling
            // path (the B->C case above) is a convergence, not a loop, and must not be recorded
            // as one.
            let isCycle = false;
            for (let at: string | undefined = id; !isCycle && at !== undefined; at = parent.get(at)) {
              if (at === other) isCycle = true;
            }
            if (isCycle) {
              const loop: string[] = [other];
              for (let at: string | undefined = id; at !== undefined && at !== other; at = parent.get(at)) {
                loop.push(at);
              }
              flow.cycles.push({ nodes: loop, edges: [flowEdge] });
            }
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
