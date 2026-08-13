/** ONE settled layout of a deck fixture, shared by the drawing-quality tests and the measurement
 *  harness. It exists because those two had a copy each and the copies drifted: the harness's trial
 *  gained a pass the test's did not, so for a while the gate measured a board the app no longer
 *  drew.
 *
 *  The tick loop here is GraphView's loop, and that is the reason to have this file at all.
 *  Anything that changes it must change here, once. */
import { countOverlaps, createBoardSimulation, linkDistanceFor, type BoardParams, type Sim, type SimLink } from "./board-force.js";
import { edgeCrossings, linkDistError, hubFreedom, type QualityMetrics } from "./board-quality.js";
import type { CardGraph } from "../types.js";

/** The shape both the checked-in fixtures and the harness's JSON files have. `buildCategories` and
 *  `combos` ride along in the captured JSON (the report they came from had them) and nothing here
 *  reads them -- the board is the graph and only the graph now. */
export interface TrialFixture {
  graph: CardGraph;
}

export interface TrialOptions {
  params?: Partial<BoardParams>;
  ticks?: number;
  /** Further ticks to sample motion over once settled; 0 skips the sampling entirely. */
  motionTicks?: number;
}

/** A seeded LCG, so a trial is reproducible from its seed. d3-force is itself deterministic (it
 *  seeds its own fixed LCG), so ALL trial-to-trial variance has to come from the initial seeding --
 *  which is exactly where it comes from in the browser today, via Math.random() in seedPosition's
 *  fallback. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296);
}

function mean(xs: readonly number[]) { return xs.reduce((a, b) => a + b, 0) / (xs.length || 1); }

/** Everything derived from the fixture is hoisted out of the returned closure -- it is the same for
 *  every seed, and rebuilding it per trial is pure cost. */
export function boardTrial(fx: TrialFixture, opts: TrialOptions = {}) {
  const { params, ticks = 800, motionTicks = 0 } = opts;
  const graph = fx.graph;

  return (seed: number) => {
    const random = lcg(seed);
    const nodes: Sim[] = graph.nodes.map((n, i) => ({
      ...n,
      x: Math.cos(i) * 260 + random() * 30,
      y: Math.sin(i) * 260 + random() * 30,
      vx: 0, vy: 0, deg: 0,
    }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = graph.edges
      .map((e) => ({ source: byId.get(e.from), target: byId.get(e.to), weight: e.weight }))
      .filter((l): l is SimLink => Boolean(l.source && l.target));
    for (const l of links) { l.source.deg++; l.target.deg++; }
    // Over the FILTERED links, exactly as createBoardSimulation computes it. Reducing over
    // graph.edges instead would hand linkDistError a different target distance from the one the
    // simulation actually aimed at, the moment any edge names a card the graph does not hold --
    // and this is the instrument Task 6 ratchets against, so a silent disagreement here is worse
    // than a wrong board.
    const maxWeight = links.reduce((m, l) => Math.max(m, l.weight), 0);

    const simulation = createBoardSimulation({ nodes, links, params });
    for (let i = 0; i < ticks; i++) simulation.tick();

    // Motion on the SETTLED board, over the same window the measurements doc sampled in Chrome
    // (180 ticks ~ 3 s at 60 fps). The quality metrics do not need it and do not pay for it.
    const before = nodes.map((n) => ({ x: n.x, y: n.y }));
    for (let i = 0; i < motionTicks; i++) simulation.tick();
    const moved = nodes.map((n, i) => Math.hypot(n.x - before[i].x, n.y - before[i].y));

    const at = Object.fromEntries(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    const edges = links.map((l) => ({
      from: l.source.id, to: l.target.id, target: linkDistanceFor(l.weight, maxWeight),
    }));
    const quality: QualityMetrics = {
      nodeOverlaps: countOverlaps(nodes),
      edgeCrossings: edgeCrossings(edges, at),
      linkDistError: linkDistError(edges, at),
      hubFreedom: hubFreedom(graph.nodes),
    };
    return {
      ...quality,
      // The settled board itself, for diagnosis: a metric says how many pairs are wrong, and the
      // next question is always WHICH. Callers that only want numbers ignore it.
      nodes,
      cards: nodes.length,
      edges: links.length,
      motionMean: mean(moved),
      motionMax: moved.length ? Math.max(...moved) : 0,
    };
  };
}
