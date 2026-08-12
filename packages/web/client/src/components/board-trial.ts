/** ONE settled layout of a deck fixture, shared by the acceptance test and the measurement
 *  harness. It exists because those two had a copy each and the copies drifted: the harness's
 *  trial gained the hold pass when holdCardCentroid shipped and the test's did not, so for a while
 *  the acceptance gate measured a board the app no longer drew.
 *
 *  The tick loop here is GraphView's loop -- tick -> project -> hold -- and that ordering is the
 *  reason to have this file at all. Anything that changes it must change here, once. */
import {
  boardMetrics, countOverlaps, createBoardSimulation, holdCardCentroid, projectRoomMembership,
  universalRooms, type BoardParams, type Sim,
} from "./board-force.js";
import { roomTallies, type RoomId } from "./deck-rooms.js";
import { PRESETS, cardFacts, roomsForFacts } from "./presets.js";
import type { CardGraph } from "../types.js";

/** The shape both the checked-in fixtures and the harness's JSON files have. */
export interface TrialFixture {
  graph: CardGraph;
  buildCategories?: { category: string; count: number; target: number }[];
  combos: { cards: string[] }[];
}

export interface TrialOptions {
  /** Index into PRESETS. 0 (Role) is what the acceptance gate measures. */
  presetIndex?: number;
  params?: Partial<BoardParams>;
  ticks?: number;
  /** `false` reproduces the board as it was before holdCardCentroid shipped. */
  pin?: boolean;
  /** `false` drops the membership projection, leaving the soft forces to place cards on their own.
   *  An arm, not a mode: the projection is part of the board's definition, and this exists to
   *  attribute a metric to it. */
  project?: boolean;
  /** Where the projection sits relative to the tick. `"tick-first"` is what GraphView ships:
   *  tick -> project -> hold, so the projection gets the last positional word and forceCollide
   *  never sees what it did. `"project-first"` lets collide answer it within the same frame. */
  order?: "tick-first" | "project-first";
  /** Further ticks to sample motion over once settled; 0 skips the sampling entirely. */
  motionTicks?: number;
}

/** A seeded LCG, so a trial is reproducible from its seed. d3-force is itself deterministic
 *  (it seeds its own fixed LCG), so ALL trial-to-trial variance has to come from the initial
 *  seeding -- which is exactly where it comes from in the browser today, via Math.random() in
 *  seedPosition's fallback. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296);
}

function mean(xs: readonly number[]) { return xs.reduce((a, b) => a + b, 0) / (xs.length || 1); }
function centroid(cards: readonly { x: number; y: number }[]) {
  return { x: mean(cards.map((c) => c.x)), y: mean(cards.map((c) => c.y)) };
}

/** Everything derived from (fixture, preset) is hoisted out of the returned closure -- it is the
 *  same for every seed, and rebuilding it per trial is pure cost. */
export function boardTrial(fx: TrialFixture, opts: TrialOptions = {}) {
  const {
    presetIndex = 0, params, ticks = 800, pin = true, project = true,
    order = "tick-first", motionTicks = 0,
  } = opts;
  const graph = fx.graph;
  const comboCards = new Set(fx.combos.flatMap((c) => c.cards));
  const facts = cardFacts(graph, comboCards);
  // The preset's rooms, not deck-rooms.ts's bare ROOMS: roomsForFacts needs each room's `test`
  // predicate, which only the preset builds.
  const rooms = PRESETS[presetIndex].rooms(facts);
  const roomsByNode = new Map<string, readonly RoomId[]>(
    facts.map((f) => [f.id, roomsForFacts(rooms, f)]),
  );

  const cardRooms = new Map<string, readonly RoomId[]>();
  const copies = new Map<string, number>();
  for (const n of graph.nodes) {
    if (n.kind !== "card") continue;
    cardRooms.set(n.label, roomsByNode.get(n.id) ?? []);
    copies.set(n.label, n.copies ?? 1);
  }
  const tallies = roomTallies(
    cardRooms,
    rooms.map((r) => ({ id: r.id, categories: r.categories ?? [] })),
    fx.buildCategories,
    copies,
  );

  return (seed: number) => {
    const random = lcg(seed);
    // Only card nodes are visible on first paint (DIM_BY_DEFAULT hides every other kind), which
    // is the state the acceptance condition is about.
    const nodes: Sim[] = graph.nodes.map((n, i) => ({
      ...n,
      x: Math.cos(i) * 260 + random() * 30,
      y: Math.sin(i) * 260 + random() * 30,
      vx: 0, vy: 0, deg: 0,
    }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links = graph.edges
      .map((e) => ({ source: byId.get(e.from)!, target: byId.get(e.to)! }))
      .filter((l) => l.source && l.target);
    for (const l of links) { l.source.deg++; l.target.deg++; }

    const visible = (n: Sim) => n.kind === "card";
    const universal = universalRooms(
      rooms.map((r) => r.id),
      nodes.filter(visible).map((n) => roomsByNode.get(n.id) ?? []),
    );

    const { simulation, roomCircles } = createBoardSimulation({
      nodes, links, roomsByNode, rooms, tallies, universal, visible, params,
    });

    const cards = nodes.filter(visible);
    const tick = () => {
      if (order === "project-first" && project) {
        projectRoomMembership(cards, roomCircles, roomsByNode);
      }
      simulation.tick();
      // Projection and hold are part of the board's DEFINITION, not paint-time niceties --
      // GraphView runs both here, in this order. Measuring without them would measure a board
      // that does not exist, and centerPull reads absolute positions, so dropping the hold
      // changes what the next tick's forces see.
      //
      // `unresolved` is the LAST tick's count, not the worst over the run: the first few ticks
      // start from a ring of cards whose room circles are enormous and mutually overlapping, so a
      // max is dominated by chaos the settled board has nothing to do with. Measured:
      // worst-over-run 77 per trial with the projection disabled entirely, against 1-3 intrusions
      // on the same settled boards.
      if (order === "tick-first" && project) {
        projectRoomMembership(cards, roomCircles, roomsByNode);
      }
      if (pin) holdCardCentroid(nodes, cards);
    };
    for (let i = 0; i < ticks; i++) tick();

    // Motion on the SETTLED board, over the same window the measurements doc sampled in Chrome
    // (180 ticks ~ 3 s at 60 fps). The acceptance gate does not need it and does not pay for it.
    const before = cards.map((n) => ({ x: n.x, y: n.y }));
    const cBefore = centroid(cards);
    for (let i = 0; i < motionTicks; i++) tick();
    const moved = cards.map((n, i) => Math.hypot(n.x - before[i].x, n.y - before[i].y));
    const cAfter = centroid(cards);

    // Counted on the FINAL board with maxPasses 0 -- it counts without moving anything. Taking it
    // from whichever projection call happened last would make the number mean different things in
    // the two orders: under project-first the last call predates a tick that moved every card.
    const unresolved = project ? projectRoomMembership(cards, roomCircles, roomsByNode, 0) : 0;

    const circles = [...roomCircles().entries()].map(([id, c]) => ({ id, ...c }));
    const metrics = boardMetrics(
      cards.map((n) => ({ x: n.x, y: n.y, rooms: roomsByNode.get(n.id) ?? [] })),
      circles,
    );
    return {
      ...metrics,
      // The settled board itself, for diagnosis: a metric says how many cards are wrong, and the
      // next question is always WHICH. Callers that only want numbers ignore it.
      nodes,
      circles,
      // The Task-9 no-overlap gate: two card discs closer than 2 * ART_RADIUS visibly overlap.
      overlaps: countOverlaps(cards),
      unresolved,
      cards: cards.length,
      rooms: rooms.length,
      motionMean: mean(moved),
      motionMax: moved.length ? Math.max(...moved) : 0,
      drift: Math.hypot(cAfter.x - cBefore.x, cAfter.y - cBefore.y),
    };
  };
}
