import { describe, expect, test } from "vitest";
import { forceCollide, forceLink, forceManyBody, forceX, forceY } from "d3-force";
import {
  ALPHA_DECAY, ALPHA_FLOOR, ART_RADIUS, CENTER_PULL, COLLIDE_ITERATIONS, DEFAULT_PARAMS,
  LINK_DIST_MAX, LINK_DIST_MIN, LINK_STRENGTH_K, REPULSION, REPULSION_RANGE, VELOCITY_DECAY,
  countOverlaps, createBoardSimulation, linkDistanceFor, linkStrengthFor, nodeRadius,
  type BoardParams, type Sim, type SimLink,
} from "./board-force.js";
import { boardTrial, type TrialFixture } from "./board-trial.js";
import inalla from "../fixtures/inalla-graph.json" with { type: "json" };

function card(id: string, x: number, y: number): Sim {
  return {
    id, label: id, copies: 1, types: ["creature"], subtypes: [], supertypes: [], colors: [],
    cmc: 1, x, y, vx: 0, vy: 0, deg: 0,
  };
}

describe("linkDistanceFor", () => {
  test("puts the strongest edge in the deck at the minimum distance", () => {
    expect(linkDistanceFor(8, 8)).toBeCloseTo(LINK_DIST_MIN);
  });

  test("puts the weakest edge at the maximum distance", () => {
    expect(linkDistanceFor(0, 8)).toBeCloseTo(LINK_DIST_MAX);
  });

  test("is monotonic: a stronger pair is never drawn further apart", () => {
    const d = [1, 2, 3, 4, 5].map((w) => linkDistanceFor(w, 5));
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeLessThanOrEqual(d[i - 1]);
  });

  test("does not divide by zero when a deck has no edges at all", () => {
    expect(Number.isFinite(linkDistanceFor(0, 0))).toBe(true);
  });

  // The normalisation is by the DECK's own maximum, so a deck of weak edges spreads across the
  // canvas instead of collapsing at LINK_DIST_MAX. Same weight, two decks, two distances.
  test("reads a weight against its own deck's maximum, not an absolute scale", () => {
    expect(linkDistanceFor(2, 2)).toBeCloseTo(LINK_DIST_MIN);
    expect(linkDistanceFor(2, 20)).toBeGreaterThan(LINK_DIST_MIN);
  });

  // The minimum has to clear two 14-unit discs plus the pad collision leaves between them, or the
  // strongest pair on the board is a spring fighting forceCollide forever.
  test("never asks for a distance two card discs cannot occupy", () => {
    expect(LINK_DIST_MIN).toBeGreaterThan(2 * ART_RADIUS);
  });
});

describe("linkStrengthFor", () => {
  test("scales with weight, up to the constant at the deck's maximum", () => {
    expect(linkStrengthFor(8, 8)).toBeCloseTo(LINK_STRENGTH_K);
    expect(linkStrengthFor(4, 8)).toBeCloseTo(LINK_STRENGTH_K / 2);
  });

  test("is zero, not NaN, for a deck with no edges", () => {
    expect(linkStrengthFor(0, 0)).toBe(0);
  });

  test("takes the strength knob as an argument, so the tuning panel can reach it", () => {
    expect(linkStrengthFor(8, 8, 0.2)).toBeCloseTo(0.2);
  });

  // d3 clamps into [0,1] internally, but a weight above the maximum handed in is a caller bug and
  // must not silently produce a stronger spring than the deck's own strongest pair.
  test("clamps a weight above the maximum rather than exceeding the constant", () => {
    expect(linkStrengthFor(80, 8)).toBeCloseTo(LINK_STRENGTH_K);
  });
});

describe("nodeRadius", () => {
  test("is the radius a card's art is drawn at", () => {
    expect(nodeRadius()).toBe(ART_RADIUS);
  });
});

describe("countOverlaps", () => {
  test("counts a pair once, not twice", () => {
    expect(countOverlaps([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe(1);
  });

  test("exactly 2 * ART_RADIUS apart is not an overlap", () => {
    expect(countOverlaps([{ x: 0, y: 0 }, { x: 2 * ART_RADIUS, y: 0 }])).toBe(0);
  });

  test("a hair closer than 2 * ART_RADIUS is", () => {
    expect(countOverlaps([{ x: 0, y: 0 }, { x: 2 * ART_RADIUS - 0.01, y: 0 }])).toBe(1);
  });

  test("counts every overlapping pair, not every overlapping card", () => {
    // Three mutually overlapping cards are three pairs.
    expect(countOverlaps([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }])).toBe(3);
  });

  test("is zero for fewer than two cards", () => {
    expect(countOverlaps([])).toBe(0);
    expect(countOverlaps([{ x: 0, y: 0 }])).toBe(0);
  });
});

describe("createBoardSimulation's stated invariants", () => {
  // The simulation must come back STOPPED: GraphView's requestAnimationFrame paint loop is what
  // calls tick(), and d3's own d3-timer stepper would be a SECOND loop on a schedule independent
  // of paint. That failure is invisible -- the board just settles faster -- so it needs an
  // assertion rather than a code reading.
  //
  // Reads alpha rather than node positions because this test makes NO manual tick() calls between
  // its two assertions, so any alpha movement can only have come from an automatic second loop.
  test("comes back stopped, so nothing ticks it but the caller", async () => {
    const simulation = createBoardSimulation({
      nodes: [card("a", 10, 0), card("b", -10, 0)], links: [],
    });
    expect(simulation.alpha()).toBe(1);
    // Long enough for d3-timer to have fired several times (it steps on rAF, or setTimeout ~17ms
    // without one) had the simulation been left running.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(simulation.alpha()).toBe(1);
  });

  /** What replaced holdCardCentroid. The room board WALKED -- 67 world units of drift every 3s --
   *  because forceX/forceY claimed only UNZONED nodes, so a roomed card had no absolute anchor at
   *  all and a common-mode velocity was invisible to every force. Every node is pulled toward the
   *  origin now, so the board comes back on its own and the positional pass could go. */
  test("pulls a board displaced from the origin back toward it", () => {
    const nodes = Array.from({ length: 12 }, (_, i) => card(`c${i}`, 800 + Math.cos(i) * 40, Math.sin(i) * 40));
    const simulation = createBoardSimulation({ nodes, links: [] });
    const centroidX = () => nodes.reduce((s, n) => s + n.x, 0) / nodes.length;
    const before = centroidX();
    for (let i = 0; i < 400; i++) simulation.tick();
    expect(centroidX()).toBeLessThan(before);
  });

  // Every node takes the centre pull now, not just the ones no room claimed -- a card with no
  // synergy edge at all has nothing else holding it anywhere near the board.
  test("gives every node the centre pull", () => {
    const s = createBoardSimulation({ nodes: [card("a", 0, 0)], links: [] });
    const x = s.force("x") as ReturnType<typeof forceX>;
    expect((x.strength() as (n: Sim, i: number, ns: Sim[]) => number)(card("a", 0, 0), 0, []))
      .toBe(CENTER_PULL);
  });

  // The whole point of the task: an edge's WEIGHT sets both its rest length and how hard that rest
  // length is enforced. Read back through d3's own accessors, so a `.distance(60)` constant --
  // which would draw every synergy alike -- fails here.
  test("hands each edge its own weight-derived distance and strength", () => {
    const a = card("a", 0, 0), b = card("b", 0, 0), c = card("c", 0, 0);
    const strong: SimLink = { source: a, target: b, weight: 8 };
    const weak: SimLink = { source: a, target: c, weight: 1 };
    const link = createBoardSimulation({ nodes: [a, b, c], links: [strong, weak] })
      .force("link") as ReturnType<typeof forceLink>;
    const distance = link.distance() as (l: SimLink, i: number, ls: unknown[]) => number;
    const strength = link.strength() as (l: SimLink, i: number, ls: unknown[]) => number;
    expect(distance(strong, 0, [])).toBeCloseTo(LINK_DIST_MIN);
    expect(distance(weak, 1, [])).toBeGreaterThan(distance(strong, 0, []));
    expect(strength(strong, 0, [])).toBeCloseTo(LINK_STRENGTH_K);
    expect(strength(weak, 1, [])).toBeLessThan(strength(strong, 0, []));
  });

  // The maximum is the DECK's, so the same edge in a stronger deck is drawn further out. Nothing
  // but this test can see it: both simulations report a legal-looking distance on their own.
  test("normalises against the deck it is given, not a module-level scale", () => {
    const distanceOf = (weights: number[]) => {
      const nodes = weights.map((_, i) => card(`c${i}`, 0, 0));
      const hub = card("hub", 0, 0);
      const links: SimLink[] = weights.map((weight, i) => ({ source: hub, target: nodes[i], weight }));
      const link = createBoardSimulation({ nodes: [hub, ...nodes], links })
        .force("link") as ReturnType<typeof forceLink>;
      return (link.distance() as (l: SimLink, i: number, ls: unknown[]) => number)(links[0], 0, []);
    };
    expect(distanceOf([2, 2])).toBeCloseTo(LINK_DIST_MIN);
    expect(distanceOf([2, 20])).toBeGreaterThan(LINK_DIST_MIN);
  });
});

describe("BoardParams", () => {
  const sim = (params?: Partial<BoardParams>) =>
    createBoardSimulation({ nodes: [card("a", -50, 0), card("b", 50, 0)], links: [], params });

  test("DEFAULT_PARAMS carries the exported constants", () => {
    expect(DEFAULT_PARAMS).toEqual({
      repulsion: REPULSION,
      repulsionRange: REPULSION_RANGE,
      linkStrengthK: LINK_STRENGTH_K,
      centerPull: CENTER_PULL,
      velocityDecay: VELOCITY_DECAY,
      alphaDecay: ALPHA_DECAY,
      alphaFloor: ALPHA_FLOOR,
      collideIterations: COLLIDE_ITERATIONS,
    });
  });

  test("an override reaches the force it names", () => {
    const charge = sim({ repulsion: 999 }).force("charge") as ReturnType<typeof forceManyBody>;
    // forceManyBody stores strength as a per-node accessor, so read it back through the accessor.
    expect((charge.strength() as (n: Sim, i: number, ns: Sim[]) => number)(
      card("a", 0, 0), 0, [],
    )).toBe(-999);
  });

  test("an absent key falls back to the exported constant", () => {
    const s = sim({ repulsion: 999 });
    expect(s.velocityDecay()).toBeCloseTo(VELOCITY_DECAY, 10);
    expect(s.alphaDecay()).toBeCloseTo(ALPHA_DECAY, 10);
    expect(s.alphaTarget()).toBeCloseTo(ALPHA_FLOOR, 10);
  });

  test("no params at all is the same simulation as before", () => {
    const charge = sim().force("charge") as ReturnType<typeof forceManyBody>;
    expect((charge.strength() as (n: Sim, i: number, ns: Sim[]) => number)(
      card("a", 0, 0), 0, [],
    )).toBe(-REPULSION);
  });

  // Each test below pins one remaining key through the actual force it wires: reverting any single
  // `p.x` reference in createBoardSimulation to a bare constant must fail something.
  test("repulsionRange override reaches the charge force's distanceMax", () => {
    const charge = sim({ repulsionRange: 123 }).force("charge") as ReturnType<typeof forceManyBody>;
    expect(charge.distanceMax()).toBe(123);
  });

  test("linkStrengthK override reaches the link force", () => {
    const a = card("a", 0, 0), b = card("b", 0, 0);
    const links: SimLink[] = [{ source: a, target: b, weight: 4 }];
    const link = createBoardSimulation({ nodes: [a, b], links, params: { linkStrengthK: 0.2 } })
      .force("link") as ReturnType<typeof forceLink>;
    expect((link.strength() as (l: SimLink, i: number, ls: unknown[]) => number)(links[0], 0, []))
      .toBeCloseTo(0.2);
  });

  test("centerPull override reaches the x and y centering forces", () => {
    const s = sim({ centerPull: 0.5 });
    const x = s.force("x") as ReturnType<typeof forceX>;
    const y = s.force("y") as ReturnType<typeof forceY>;
    expect((x.strength() as (n: Sim, i: number, ns: Sim[]) => number)(card("a", 0, 0), 0, [])).toBe(0.5);
    expect((y.strength() as (n: Sim, i: number, ns: Sim[]) => number)(card("a", 0, 0), 0, [])).toBe(0.5);
  });

  test("collideIterations override reaches the collide force", () => {
    const collide = sim({ collideIterations: 7 }).force("collide") as ReturnType<typeof forceCollide>;
    expect(collide.iterations()).toBe(7);
  });

  test("velocityDecay, alphaDecay and alphaFloor overrides reach the simulation", () => {
    const s = sim({ velocityDecay: 0.5, alphaDecay: 0.1, alphaFloor: 0.3 });
    expect(s.velocityDecay()).toBeCloseTo(0.5, 10);
    expect(s.alphaDecay()).toBeCloseTo(0.1, 10);
    expect(s.alphaTarget()).toBeCloseTo(0.3, 10);
  });
});

/** One settled layout of the inalla fixture at the shipped constants. The trial body lives in
 *  board-trial.ts so the measurement harness runs the SAME loop -- they had a copy each and the
 *  copies drifted. */
const runTrial = boardTrial(inalla as TrialFixture);

/** ASSERTIONS ONLY -- board-layout.harness.ts is the measurement instrument, and it is the only
 *  caller that asks for motion ticks. A printed table here was the second instrument that produced
 *  the wrong measurement table in this task's first pass: `motionTicks` defaults to 0, so a motion
 *  number read from this suite is structurally zero and means nothing. */
describe("the settled board, ten trials on inalla", () => {
  const trials = Array.from({ length: 10 }, (_, i) => runTrial(i + 1));

  // The invariant the projection exists to hold, asserted here rather than capped: a facet value
  // appearing as a node is not a budget to spend down. `color:B` reached degree 83 in an 84-card
  // deck when facets were nodes.
  test("draws cards and nothing else", () => {
    expect(trials.flatMap((t) => t.hubFreedom)).toEqual([]);
  });

  // The hard readability condition. forceCollide is velocity-based, so this is the assertion at
  // risk if any constant moves.
  test("no two card discs overlap, in any trial", () => {
    expect(trials.map((t) => t.nodeOverlaps)).toEqual(new Array(10).fill(0));
  });

  /** The metric and the simulation must normalise the weight scale over the SAME edge set.
   *  `boardTrial` used to reduce over `fx.graph.edges` while createBoardSimulation reduces over the
   *  FILTERED links, so one off-deck edge carrying a big weight would have the simulation aim at
   *  LINK_DIST_MIN while linkDistError scored the board against something near LINK_DIST_MAX.
   *  Every checked-in fixture asserts offDeckReasons 0, so nothing caught it -- this fixture does. */
  test("scores the board against the distances the simulation actually aimed at", () => {
    const bare = { copies: 1, types: [], subtypes: [], supertypes: [], colors: [], cmc: 1 };
    const two = boardTrial({
      graph: {
        nodes: [{ id: "A", label: "A", ...bare }, { id: "B", label: "B", ...bare }],
        edges: [
          { from: "A", to: "B", weight: 1, tags: [], reasonTexts: [] },
          // Names a card the graph does not hold, and carries 100x the real edge's weight.
          { from: "A", to: "Nowhere", weight: 100, tags: [], reasonTexts: [] },
        ],
        undirectedReasons: 0, offDeckReasons: 0,
      },
    })(1);
    // The one surviving edge IS the deck's maximum, so it is drawn at LINK_DIST_MIN and a settled
    // two-card board sits nearly on it. Reducing over the unfiltered list instead puts the target
    // near LINK_DIST_MAX against an actual ~60, and this error jumps to ~198.
    expect(two.linkDistError).toBeLessThan(10);
  });
});
