import {
  forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type Simulation,
} from "d3-force";
import type { GraphNode } from "../types.js";

/** Radius (world units) a card node draws at. Lived in deck-rooms.ts until rooms retired; it is a
 *  property of the CARD, not of the geometry that used to group them, so it belongs beside
 *  nodeRadius -- the one function that reads it. */
export const ART_RADIUS = 14;
/** The gap forceCollide leaves between two settled discs. Half of it rides on each disc. */
export const COLLISION_PAD = 5;

/** A graph node as the force simulation sees it. `index` is written by d3-force itself when the
 *  node array is bound to a simulation; it is not ours to set.
 *
 *  `deg` is how many synergy PARTNERS a card has -- read by the hover tooltip, no longer by
 *  nodeRadius (see below). */
export interface Sim extends GraphNode {
  x: number; y: number; vx: number; vy: number; deg: number; index?: number;
}

/** An edge as forceLink needs it: d3 hardcodes `source`/`target`, so the wire's `from`/`to` are
 *  mapped once at the call site. `weight` is what the link distance and strength read. */
export interface SimLink { source: Sim; target: Sim; weight: number }

/** The radius a node is DRAWN at, in world units. Every consumer -- the repulsion sweep, the edge
 *  springs, hit-testing, the overlap metric -- reads this one function, so the simulated size and
 *  the painted size cannot drift apart. They did: cards simulated at 3.5 while their art painted at
 *  ART_RADIUS (14), so nodes settled until they touched at ~7px apart and were then drawn four
 *  times that size. That mismatch is what made the graph unreadable.
 *
 *  It takes no argument any more, and that is the projection's doing rather than a simplification:
 *  every node is a card now, so the old `kind === "card" ? ART_RADIUS : f(deg)` branch has one
 *  live arm. Degree is deliberately NOT reinstated as a size input -- an edge is binary but synergy
 *  has magnitude (CLAUDE.md), so a node sized by raw partner count would say "important" about a
 *  card with many weak edges. Sizing by total edge WEIGHT is the real question and is a scoring
 *  change, not a layout one. */
export function nodeRadius(): number {
  return ART_RADIUS;
}

/** Pairs of card discs that visibly overlap -- centres closer than two art radii. The hard
 *  readability condition for a settled board, and the same rule the ten-trial harness uses, so a
 *  number read off the tuning panel is comparable with the measurement table.
 *
 *  O(n^2) over ~95 cards, called four times a second by the panel -- immaterial, and far cheaper
 *  than the quadtree repulsion running every frame beside it. */
export function countOverlaps(cards: readonly { x: number; y: number }[]): number {
  let overlaps = 0;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (Math.hypot(cards[i].x - cards[j].x, cards[i].y - cards[j].y) < 2 * ART_RADIUS) overlaps++;
    }
  }
  return overlaps;
}

/** Distance a maximally weighted edge is drawn at. */
export const LINK_DIST_MIN = 60;
/** Distance a zero-weight edge is drawn at. */
export const LINK_DIST_MAX = 260;
/** Scales link strength. Set with LINK_DEGREE_NORM from the Task 6 A/B -- 0.7 was the pre-degree
 *  value and is far too weak once every spring is divided by its endpoint degree. */
export const LINK_STRENGTH_K = 1.4;
/** Divide each spring by min(deg(source), deg(target)) -- d3's own stability divisor, measured back
 *  in. Chosen over the undivided board on six arms x five fixtures x ten seeded trials; see the
 *  table on QUALITY_CAPS. Without it nothing settles: sorin walked 119 world units over the 180
 *  ticks after 800, which is half a link length per node, forever. */
export const LINK_DEGREE_NORM = true;

/** Weight -> target distance, descending: a strong pair sits closer. Normalised by the DECK's own
 *  maximum rather than an absolute scale, because impactEdgeWeight is unbounded and a deck of
 *  weak edges should still spread across the canvas rather than collapse at LINK_DIST_MAX. */
export function linkDistanceFor(weight: number, maxWeight: number): number {
  if (maxWeight <= 0) return LINK_DIST_MAX;
  const t = Math.min(1, Math.max(0, weight / maxWeight));
  return LINK_DIST_MAX - t * (LINK_DIST_MAX - LINK_DIST_MIN);
}

/** How hard that distance is enforced -- also proportional to weight, so a strong pair is held at
 *  its short rest length while a weak one is a suggestion the rest of the board can overrule.
 *  `k` is the knob (BoardParams.linkStrengthK); the constant is its default.
 *
 *  `degree` is d3's own stability divisor, restored as an OPTION: min(deg(source), deg(target)).
 *  d3 applies each link's correction in sequence within a tick, so a degree-70 hub takes 70 of them
 *  per tick and can be displaced further than any single spring asked for -- the board then walks
 *  instead of settling. Dividing by the smaller endpoint's degree bounds that, and leaves a leaf
 *  card's spring at full strength (min-degree is the leaf's own), so it is not a global softening.
 *  Measured both ways in Task 6; see the table on QUALITY_CAPS for which arm ships and what it
 *  cost. */
export function linkStrengthFor(
  weight: number, maxWeight: number, k: number = LINK_STRENGTH_K, degree: number = 1,
): number {
  if (maxWeight <= 0) return 0;
  return k * Math.min(1, Math.max(0, weight / maxWeight)) / Math.max(1, degree);
}

/** Repulsion strength -- 2200 in the hand-rolled loop, 25 here, and the change is a UNIT change,
 *  not a retune. forceManyBody's law is inverse-LINEAR (k*alpha/d), not the loop's inverse-square
 *  (k/d^2); see the d3 migration doc's 3.1. At the ~33-unit spacing collision settles cards to,
 *  1/d is ~33x stronger than 1/d^2 for the same k, and alpha scales the FORCE here rather than the
 *  integration step, so the loop's number could not carry across.
 *
 *  Bracketed on the ten-trial room harness (`2026-08-08-d3-migration-measurements.md`). That gate
 *  measured room escapes and intrusions, which no longer exist -- the value survives as the one
 *  that produced a readable board at these node sizes, and Task 6 re-brackets it against the
 *  drawing-quality metrics (overlaps, crossings, link-distance error) instead. */
export const REPULSION = 25;
/** How far repulsion reaches, in world units. Ported from the old loop's `d2 > 220000` cutoff.
 *  Wider than the board is across, so every card repels every other one -- with rooms gone, this
 *  and the link springs are the whole layout, and a short range would let unconnected components
 *  drift through each other. */
export const REPULSION_RANGE = 469;
/** Pull toward the origin. Every node gets it now: a room used to anchor a card absolutely, and
 *  without one a component connected to nothing has no position at all. It is also what replaced
 *  holdCardCentroid -- a board every node is pulled toward cannot walk off screen. */
export const CENTER_PULL = 0.0004;
/** d3's setter stores `1 - _`, so this yields the 0.86 retention the old VELOCITY_DAMPING had. */
export const VELOCITY_DECAY = 0.14;
export const ALPHA_DECAY = 0.005;
/** The loop FLOORS alpha and keeps ticking forever; it never stops. alphaTarget reproduces that,
 *  alphaMin would stop the simulation instead. */
export const ALPHA_FLOOR = 0.02;
/** forceCollide is velocity-based, so it converges on overlaps rather than guaranteeing they are
 *  gone. Measured across every REPULSION value tried: zero overlapping discs at d3's default 1
 *  iteration, because integration is `x += vx *= 0.86` immediately after the force pass. */
export const COLLIDE_ITERATIONS = 1;

/** The constants above, as one object a caller can override. The constants themselves stay the
 *  source of truth -- this references them rather than restating their numbers, so the measurement
 *  comments above remain the only place a value is written down.
 *
 *  Exists for the dev tuning panel (BoardTuner). Nothing in the product passes `params`. */
export interface BoardParams {
  repulsion: number;
  repulsionRange: number;
  linkStrengthK: number;
  /** Divide link strength by the smaller endpoint's degree -- see linkStrengthFor. */
  linkDegreeNorm: boolean;
  centerPull: number;
  velocityDecay: number;
  alphaDecay: number;
  alphaFloor: number;
  collideIterations: number;
}

export const DEFAULT_PARAMS: BoardParams = {
  repulsion: REPULSION,
  repulsionRange: REPULSION_RANGE,
  linkStrengthK: LINK_STRENGTH_K,
  linkDegreeNorm: LINK_DEGREE_NORM,
  centerPull: CENTER_PULL,
  velocityDecay: VELOCITY_DECAY,
  alphaDecay: ALPHA_DECAY,
  alphaFloor: ALPHA_FLOOR,
  collideIterations: COLLIDE_ITERATIONS,
};

/** The whole board layout as one d3 simulation: repulsion, weighted synergy springs, disc
 *  collision, and a centre pull.
 *
 *  POSITION MEANS SYNERGY AND NOTHING ELSE. The room forces this replaces spent the geometry on
 *  one facet permanently -- two cards sharing a type sat together whether or not they did anything
 *  for each other. Facets are PAINT now (presets.ts), which is a restyle over unchanged geometry,
 *  so every mode borrows the same layout.
 *
 *  The one thing the link force needs that d3 will not compute is the deck's own maximum weight:
 *  `impactEdgeWeight` is unbounded, so a distance normalised by anything else would either flatten
 *  a weak deck against LINK_DIST_MAX or clip a strong one at LINK_DIST_MIN.
 *
 *  Returned STOPPED. GraphView's own requestAnimationFrame paint loop calls `tick()`; d3's internal
 *  d3-timer stepper would be a second loop running on a schedule independent of paint. */
export function createBoardSimulation(opts: {
  nodes: Sim[];
  links: SimLink[];
  params?: Partial<BoardParams>;
}): Simulation<Sim, undefined> {
  const p = { ...DEFAULT_PARAMS, ...opts.params };
  const maxWeight = opts.links.reduce((m, l) => Math.max(m, l.weight), 0);

  return forceSimulation<Sim>(opts.nodes)
    .force("charge", forceManyBody<Sim>()
      .strength(-p.repulsion)
      // Ports the old `max(d2, 64)` floor and `d2 > 220000` cutoff. d3 squares these
      // internally; distanceMin is a geometric mean rather than a hard clamp.
      .distanceMin(8)
      .distanceMax(p.repulsionRange))
    .force("link", forceLink<Sim, SimLink>(opts.links)
      .id((n) => n.id)
      .distance((l) => linkDistanceFor(l.weight, maxWeight))
      // Strength is ours, not d3's default: it is proportional to the edge's WEIGHT, which d3
      // knows nothing about. Whether d3's degree divisor is reapplied on top is the
      // linkDegreeNorm knob -- it is a stability device, not a statement about what a hub means.
      .strength((l) => linkStrengthFor(
        l.weight, maxWeight, p.linkStrengthK,
        p.linkDegreeNorm ? Math.min(l.source.deg, l.target.deg) : 1)))
    .force("collide", forceCollide<Sim>()
      .radius(() => nodeRadius() + COLLISION_PAD / 2)
      .iterations(p.collideIterations))
    .force("x", forceX<Sim>(0).strength(p.centerPull))
    .force("y", forceY<Sim>(0).strength(p.centerPull))
    .velocityDecay(p.velocityDecay)
    .alphaDecay(p.alphaDecay)
    .alphaTarget(p.alphaFloor)
    .stop();
}
