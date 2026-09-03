import type { CardGraph } from "../types.js";

type Edge = CardGraph["edges"][number];

/** Edges kept per selected card, per direction, strongest first. The panel says what was cut, per
 *  card ("feeds 32, showing 6"), rather than the board quietly drawing a different number than the
 *  deck contains.
 *
 *  RE-MEASURED 2026-09-03 over the 71 calibration decks, 8,573 node-directions
 *  (`matcher/src/bin/fanout-cap.ts`), and the old figures had drifted: p95 was 15 and reads 12,
 *  p99 was 41 and reads 37, max 80 and reads 81. Current distribution:
 *
 *    fan size, all:    p50 3 · p90 7  · p95 12 · p99 37 · max 81
 *
 *  THE "10.5% TRUNCATED" THIS CONSTANT USED TO BE DEFENDED WITH IS THE WRONG POPULATION. It
 *  reproduces (10.1%), but it weights every node-direction equally and readers do not open cards
 *  uniformly -- every surface that lists cards ranks them by partner count, so the ones a reader
 *  opens are the ones the cap bites hardest. Over the top ten by partners in each deck the fan runs
 *  p50 9 · p90 34, and this cap truncates **61.2%** of their node-directions, six times the figure
 *  it was justified with. A hub's median direction keeps 67% of its fan.
 *
 *  KEPT AT 6 FOR THE BOARD ANYWAY, and the reason is the board, not the number: everything cut is
 *  still reachable there. The inspector lists every partner, the sentence above it says how many
 *  were dropped, and the rest of the deck stays on screen around the flow. The cap is buying visual
 *  density on an already-dense canvas, not deciding what the reader may know.
 *
 *  A SURFACE WHERE THE CAP IS THE WHOLE SCREEN MUST NOT REUSE IT. On the phone ego view there is no
 *  board around the flow and no second list, so the cap there is set by how many discs clear the
 *  touch-target floor (`disc-fit.ts`), not by this constant. Raising a cap costs almost nothing in
 *  size -- ego node counts run p50 5 and p90 11 at EVERY cap from 6 to 20, because a bigger cap
 *  changes hubs only -- so that surface should take what geometry allows rather than a percentile. */
export const FLOW_FANOUT_CAP = 6;

/** Total cards a flow may draw, every selected card's fans together. One card's fans cannot exceed
 *  2 x FLOW_FANOUT_CAP, so this binds only on a multi-card selection -- which is exactly where it
 *  is needed, since selection is additive and nothing else bounds a reader who keeps clicking. */
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
  /** Cards whose fan was cut, and by how much -- keyed by direction as well as id, since a card
   *  has its own fanout in each and each has its own number to report. Keying by id alone let the
   *  upstream entry silently overwrite the downstream one, so "feeds 10, shown 6" printed as "8 in
   *  total" when the same card was also fed by 8. */
  truncated: Map<string, { up?: { total: number; shown: number }; down?: { total: number; shown: number } }>;
}

export interface FlowOptions { fanoutCap?: number; nodeBudget?: number }

/** The events a selected card produces and consumes, and the cards on the other end of them.
 *
 *  ONE HOP, DELIBERATELY. This walked the graph breadth-first to a budget of 40 cards, and the
 *  owner's verdict on it was "I can still see too much": at two hops a neighbour brought its OWN
 *  fan along, so clicking one card lit edges between two cards the reader had not asked about and
 *  whose relationship the selection said nothing about. A card's other events are suppressed until
 *  the reader selects it and makes them relevant -- which selection being additive is what makes
 *  practical, since extending the view is now one click on the card whose events you want next.
 *
 *  So an edge is drawn if and only if one of its ends is selected. Two hops are still reachable:
 *  select both ends.
 *
 *  TWO DIRECTION-PURE FANS. Downstream is `from -> to`, upstream is `to -> from`, and a card can
 *  legitimately sit in both -- it feeds a selected card and is fed by it. That is one node carrying
 *  two depths, not two nodes. */
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

  const flow: Flow = { roots, nodes: new Map(), edges: [], truncated: new Map() };

  const fanOut = (adj: Map<string, Edge[]>, dir: "up" | "down"): void => {
    for (const root of roots) {
      const all = adj.get(root) ?? [];
      const kept = [...all].sort((a, b) => b.weight - a.weight).slice(0, fanoutCap);
      if (all.length > kept.length) {
        const entry = flow.truncated.get(root) ?? {};
        entry[dir] = { total: all.length, shown: kept.length };
        flow.truncated.set(root, entry);
      }

      for (const edge of kept) {
        const other = dir === "down" ? edge.to : edge.from;
        // THE EDGE IS ALWAYS RECORDED, even when the card on the other end is another selected one
        // or is over budget. It touches something the reader selected, which is the whole test for
        // whether it belongs on screen -- and an edge between two selected cards is the single most
        // deliberate thing a reader can ask this board for.
        flow.edges.push({ from: edge.from, to: edge.to, dir, depth: 1 });
        // Roots draw as roots and are not listed as fan members; anything else joins the fan, and
        // a card already in the other direction's fan KEEPS that depth rather than losing it.
        if (roots.has(other)) continue;
        if (!flow.nodes.has(other) && flow.nodes.size >= nodeBudget) continue;
        const node = flow.nodes.get(other) ?? {};
        if (dir === "down") node.downstreamDepth = 1;
        else node.upstreamDepth = 1;
        flow.nodes.set(other, node);
      }
    }
  };

  fanOut(down, "down");
  fanOut(up, "up");
  return flow;
}
