export interface Pt { x: number; y: number }
export interface QEdge { from: string; to: string }
export interface QTargetEdge extends QEdge { target: number }

/** True iff segments pq and rs properly cross. Shared endpoints do NOT count: two edges out of one
 *  node always touch there, and counting it would swamp the real crossings with hub degree. */
function crosses(p: Pt, q: Pt, r: Pt, s: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p, q, r), d2 = d(p, q, s), d3 = d(r, s, p), d4 = d(r, s, q);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** ponytail: O(n^2) over edge pairs -- 200 edges is 20k tests, microseconds. If the projection ever
 *  ships thousands of edges, sweep-line (Bentley-Ottmann) is the upgrade. */
export function edgeCrossings(edges: readonly QEdge[], nodes: Record<string, Pt>): number {
  let n = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i], b = edges[j];
      if (a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to) continue;
      if (crosses(nodes[a.from], nodes[a.to], nodes[b.from], nodes[b.to])) n++;
    }
  }
  return n;
}

/** Root-mean-square of |actual distance - the distance the edge's weight asked for|. This is the
 *  single number saying whether the layout honoured the synergy weights at all. */
export function linkDistError(edges: readonly QTargetEdge[], nodes: Record<string, Pt>): number {
  if (edges.length === 0) return 0;
  let sum = 0;
  for (const e of edges) {
    const a = nodes[e.from], b = nodes[e.to];
    const actual = Math.hypot(b.x - a.x, b.y - a.y);
    sum += (actual - e.target) ** 2;
  }
  return Math.sqrt(sum / edges.length);
}

/** Names any node that is not a plain card. The projection exists so that this always returns [];
 *  a `kind` field is how a facet node would come back, since that is what they carried before. */
export function hubFreedom(nodes: readonly { id: string; kind?: string }[]): string[] {
  return nodes.filter((n) => n.kind !== undefined).map((n) => n.id);
}

export const FIXTURES = ["sorin", "inalla", "fairdrazi", "changelings", "braids"];

/** One fixture's measured drawing quality. Wider than `Caps` on purpose: `hubFreedom` is measured
 *  but never capped -- a facet value appearing as a node is not a budget to spend down, it is the
 *  invariant the projection exists to hold, so it is asserted empty rather than given a number. */
export interface QualityMetrics {
  nodeOverlaps: number;
  edgeCrossings: number;
  linkDistError: number;
  /** Ids of any node that is not a plain card. Must be empty. */
  hubFreedom: string[];
}

/** The three metrics from `QualityMetrics` that get a numeric budget. `hubFreedom` has no cap --
 *  see the comment on `QualityMetrics`. */
export interface Caps {
  /** Two card discs closer than 2 * ART_RADIUS. */
  nodeOverlaps: number;
  /** Properly crossing edge pairs, shared endpoints excluded. */
  edgeCrossings: number;
  /** rms |actual - target| link distance, rounded up to an integer for the table. */
  linkDistError: number;
}

/** Filled in Task 6 FROM MEASUREMENT. A cap chosen before anything was measured is a guess wearing
 *  a number. Ratchet rules, unchanged from the table this replaces: a beaten cap is lowered in the
 *  same commit; raising one needs a written reason on the line. */
export const QUALITY_CAPS: Record<string, Caps> = {};
