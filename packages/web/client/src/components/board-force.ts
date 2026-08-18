import {
  forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type Simulation,
} from "d3-force";
import type { GraphNode } from "../types.js";

/** Radius (world units) a card node draws at. Lived in deck-rooms.ts until rooms retired; it is a
 *  property of the CARD, not of the geometry that used to group them, so it belongs beside
 *  nodeRadius -- the one function that reads it. */
export const ART_RADIUS = 14;
/** A Magic card is 5:7; 1.4 is that ratio. */
export const CARD_ASPECT = 1.4;

/** What card mode paints. THE CARD IS THE PRIMITIVE and the collision follows it (owner's ruling,
 *  2026-08-18: "I would prefer having bigger cards cause they should be readable"). The first cut
 *  had this the other way round -- card sized down to fit the disc spacing -- which removed the
 *  overlap at zero layout cost but made the card 19.2 wide in the one view whose entire purpose is
 *  reading the card. */
export const CARD_W = ART_RADIUS * 2;
export const CARD_H = CARD_W * CARD_ASPECT;

/** CARD MODE MUST NOT OVERLAP, AND THE DIAGONAL IS WHAT DECIDES IT (2026-08-18; owner-reported
 *  2026-08-13 and again today, reproduced live at card zoom before any edit).
 *
 *  Two axis-aligned rectangles miss each other only when |dx| >= w OR |dy| >= h, so a CIRCULAR
 *  collision of settled centre distance D guarantees it only when D >= the card's DIAGONAL. At the
 *  old pad of 5 the spacing was 33 against a diagonal of 48.2, so cards overlapped -- and not only
 *  on the y axis as the roadmap entry had it: the worst case is diagonal neighbours.
 *
 *  MEASURED over the five fixtures, 10 seeds, 800 ticks -- mean overlapping card pairs:
 *    pad 5, card 28 x 39.2 (before)   sorin 76.3 · inalla 68.8 · fairdrazi 104.9 · changelings 16.6 · braids 19.7
 *    THIS: pad 20.2, card unchanged   sorin  3.8 · inalla  1.2 · fairdrazi   5.4 · changelings  0.1 · braids  0.0
 *    (rejected) card shrunk to 19.2   sorin  0.4 · inalla  0.5 · fairdrazi   0.3 · changelings  0.0 · braids  0.1
 *
 *  THE COST IS REAL AND IT IS THE LAYOUT'S, which is why the rejected arm was measured first: a hard
 *  48.2 floor between centres stops a dense mesh compressing, so linkDistError rises (see the
 *  re-capped table on QUALITY_CAPS). The owner took that trade for a readable card. The residual
 *  ~1-5 pairs is the SOFT collide -- one iteration, alpha decay -- letting a few pairs settle inside
 *  the radius; raising `collideIterations` to 2 takes sorin 3.8 -> 2.4 and inalla to 0.0 at more
 *  crossings, and is a knob on the tuning panel rather than a default.
 *
 *  Derived, never typed twice: the card's size decides the gap, so the two cannot drift apart --
 *  the exact failure `nodeRadius`'s comment above records. */
export const COLLISION_PAD = Math.hypot(CARD_W, CARD_H) - 2 * ART_RADIUS;

/** The centre-to-centre distance two settled nodes end up at. */
export const SETTLED_SPACING = 2 * (ART_RADIUS + COLLISION_PAD / 2);

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

/** Pairs of CARDS that overlap in card mode -- the metric `countOverlaps` above could not see.
 *
 *  It read discs (centres closer than 2 * ART_RADIUS) and reported 0 on every fixture while 76 pairs
 *  of CARDS overlapped on sorin, because a card is a rectangle and a disc is not. A gate measuring
 *  the wrong shape is worse than no gate: it says the board is clean while the user is looking at
 *  cards stacked on top of each other, which is exactly how this shipped twice.
 *
 *  Rectangles, so the test is per axis: they miss only when |dx| >= CARD_W or |dy| >= CARD_H. */
export function countCardOverlaps(cards: readonly { x: number; y: number }[]): number {
  let overlaps = 0;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (Math.abs(cards[i].x - cards[j].x) < CARD_W && Math.abs(cards[i].y - cards[j].y) < CARD_H) overlaps++;
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
 *  holdCardCentroid -- a board every node is pulled toward cannot walk off screen.
 *
 *  IT DOES NOT MEANINGFULLY ANCHOR AN ORPHAN, and this comment used to imply it did. A connected
 *  card is placed by its link springs; a deg-0 card has only repulsion pushing it out and this
 *  pulling it back, and at 0.0004 repulsion wins. Measured over 10 trials x 800 ticks, orphan mean
 *  distance from the origin against the CONNECTED mean: sorin 703 vs 171 (13 orphans), changelings
 *  736 vs 298 (36), braids 702 vs 223 (12). Orphans settle in a ring three to four times further out
 *  than the deck.
 *
 *  MEASURED AND DELIBERATELY NOT "FIXED" (2026-08-14). A per-node multiplier on this force for
 *  deg-0 nodes does pull them in -- x4 gives 552/583/563, x8 gives 478/473/500 -- but every arm
 *  regresses the drawing-quality gate, because dragging orphans through the board displaces the
 *  connected cards via repulsion: at x4, sorin crossings 42237 -> 42841 and braids 19335 -> 19559;
 *  at x8, sorin -> 43799 (+3.7%), changelings 6868 -> 7044, braids -> 20452 (+5.8%). nodeOverlaps
 *  stayed 0 throughout.
 *
 *  And the benefit is doubtful in the first place. `EDGELESS_ALPHA` exists because a blind judge
 *  read two edgeless lands as the deck's most strongly related pair, from proximity plus a matching
 *  ring colour -- so an orphan sitting OUTSIDE the connected board is arguably the correct sentence,
 *  and pulling it inward re-creates the misread that demotion was added to prevent. Revisit only
 *  with a product reason, not because the number looks small. */
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

/** Cancels the board's COMMON-MODE velocity, every tick: subtracts the mean vx/vy over all nodes
 *  from every node's own vx/vy. A node's velocity RELATIVE to every other node is untouched -- only
 *  where the shape sits moves, never the shape itself -- so this cannot substitute for CENTER_PULL
 *  (which still has to say WHERE that shape sits) and does not touch x/y directly, only the velocity
 *  a force is for.
 *
 *  Why this is needed at all: alphaTarget is a FLOOR (ALPHA_FLOOR), so the simulation never stops,
 *  and CENTER_PULL's restoring pull (0.0004) is too weak to hold the centroid against the drift the
 *  rest of the board's asymmetric forces produce -- measured on sorin, centroid distance from the
 *  origin went 27 -> 516 (800 ticks) -> 921 (40,000) and kept growing (task-10 brief). A d3 force is
 *  any `function(alpha)`, optionally with `initialize(nodes)` -- the hook d3-force calls (once, when
 *  the force is bound to a simulation) to hand a force the node array, since `force(alpha)` alone
 *  carries no other way to reach it. This one needs that hook: averaging vx/vy across the whole
 *  board has nothing to average over without the array. Registered LAST so it sees every other
 *  force's contribution to vx/vy before d3 integrates. */
function forceDeDrift() {
  let nodes: Sim[] = [];
  function force() {
    if (nodes.length === 0) return;
    let mvx = 0, mvy = 0;
    for (const n of nodes) { mvx += n.vx; mvy += n.vy; }
    mvx /= nodes.length; mvy /= nodes.length;
    for (const n of nodes) { n.vx -= mvx; n.vy -= mvy; }
  }
  force.initialize = (ns: Sim[]) => { nodes = ns; };
  return force;
}

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
  /** The gap forceCollide leaves between two settled nodes, in world units. Half rides on each.
   *  A knob and not a constant because the value the DISC needs and the value the CARD needs are
   *  different numbers -- see COLLISION_PAD. */
  collidePad: number;
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
  collidePad: COLLISION_PAD,
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
      .radius(() => nodeRadius() + p.collidePad / 2)
      .iterations(p.collideIterations))
    // BEFORE THE CENTRE PULL, AND THAT ORDER IS THE WHOLE POINT (2026-08-18). d3 applies forces in
    // insertion order, so running de-drift LAST -- as it did until now -- cancelled the centre
    // pull's own contribution: a pull toward the origin on a board far from it is almost entirely
    // COMMON-MODE, which is exactly what this force subtracts. Measured on the old order, a board
    // seeded at x=800 moved 3e-13 over 400 ticks and 2e-13 over 10,000: it stayed put forever, and
    // the comment here claimed it "comes back on its own".
    //
    // Placed here it still does its actual job, because charge, link and collide have already
    // written their contributions and any net translation from THEM is what gets cancelled. The
    // centre pull then writes a deliberate translation that nothing removes. Measured both ways,
    // 40k ticks, three seeds: centroid distance from the origin 27 -> 19 on sorin, 21 -> 15 on the
    // other four, so the anti-walk property the force exists for is kept, not traded away.
    .force("deDrift", forceDeDrift())
    .force("x", forceX<Sim>(0).strength(p.centerPull))
    .force("y", forceY<Sim>(0).strength(p.centerPull))
    .velocityDecay(p.velocityDecay)
    .alphaDecay(p.alphaDecay)
    .alphaTarget(p.alphaFloor)
    .stop();
}
