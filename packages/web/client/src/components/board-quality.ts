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

/** MEASURED, not chosen: `board-layout.harness.ts`, five fixtures x ten seeded trials, 800 ticks
 *  plus 180 motion ticks. Overlaps and crossings are summed over the ten trials, linkDistError is
 *  the ceil of their mean. A cap picked before anything was measured is a guess wearing a number.
 *
 *  Ratchet rules, unchanged from the table this replaces: over a cap is a regression and fails;
 *  UNDER one also fails, until the cap is lowered to the new number in the same commit, or an
 *  improvement can be silently spent later. Raising one needs a written reason on the line.
 *
 *  THE ARM THESE NUMBERS COME FROM. The board is degree-normalised (LINK_DEGREE_NORM) at
 *  LINK_STRENGTH_K 1.4. Six arms, same instrument, motionMean is world units a node moves over the
 *  180 ticks after settling:
 *
 *    arm          crossings (5 fixtures)                 distErr           motionMean
 *    shipped      53534 56197 69209  9623 27787          40 40 41 30 34    119.7 88.3 62.1 13.3 26.4
 *    degnorm      39009 27318 27042  6641 16093          57 54 62 47 54     13.5 13.5 11.3  5.6  5.0
 *    k012         48400 34095 43852  7001 22676          72 62 63 56 76     18.5  8.7  8.6  5.5  7.7
 *    k0133        50040 34905 41859  7300 20679          69 61 62 54 68
 *    degnorm-k1   42289 30688 34310  6768 17772          49 46 53 40 48     19.4 18.1 12.9  4.6  8.0
 *    degnorm-k14  43058 32740 35016  6736 19796          41 41 48 36 42     13.8 23.2  9.8  4.6  9.2
 *    degnorm-k2   46001 35377 43863  8024 22522          37 38 45 31 37     18.3 26.1 18.2  5.9 12.3
 *
 *  `k012`/`k0133` are the CONTROL, and they are why the divisor is degree rather than a smaller k:
 *  softening every spring uniformly by the same average factor settles the board too, but leaves
 *  crossings and link-distance error WORSE than the undivided arm on every fixture. Degree is what
 *  matters, not softness -- a leaf card's spring keeps full strength under the divisor, only hubs pay.
 *
 *  Two control values because the first was mis-derived. 0.12 came from dividing 0.7 by an
 *  ESTIMATED mean min-endpoint degree of ~6; the mean over the five fixtures' filtered links is
 *  actually 5.252 (per-fixture 4.58-5.49), so the fair control is 0.133. `k0133` is that rerun, and
 *  it loses to the shipped arm on both metrics on all five fixtures exactly as `k012` did. The
 *  estimate was wrong by 14-24% and the conclusion did not depend on it -- which is the only reason
 *  it is a footnote rather than a redo.
 *
 *  Against `shipped`, the shipped arm buys crossings -20% to -49% and motion -65% to -89% (sorin
 *  119.7 -> 13.8: it never settled at all before, it walked half a link length per node forever),
 *  and the one node overlap goes. It PAYS up to 8 units of rms link-distance error on fairdrazi and
 *  braids -- 1 unit on sorin and inalla, and it is 6 better on nothing. k2 buys that back and
 *  spends it on crossings instead; past 1.4 the crossings cost per further unit of distErr more
 *  than triples (~4.3% below it, ~14.6% above), which is the sense in which 1.4 is the knee.
 *
 *  THE TRADE IS THE OWNER'S CALL AND WAS TAKEN: signed off 2026-08-13 after the review put the
 *  three arms side by side. Distance fidelity is what says "distance means synergy", so spending 8
 *  units of it to make the board settle is a product judgement, not a computed one. `degnorm-k2` is
 *  a one-line change plus a re-cap if it is ever revisited. */
export const QUALITY_CAPS: Record<string, Caps> = {
  sorin: { nodeOverlaps: 0, edgeCrossings: 43058, linkDistError: 41 },
  inalla: { nodeOverlaps: 0, edgeCrossings: 32740, linkDistError: 41 },
  fairdrazi: { nodeOverlaps: 0, edgeCrossings: 35016, linkDistError: 48 },
  changelings: { nodeOverlaps: 0, edgeCrossings: 6736, linkDistError: 36 },
  braids: { nodeOverlaps: 0, edgeCrossings: 19796, linkDistError: 42 },
};
