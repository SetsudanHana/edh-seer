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
/** RAISED 25 -> 60 (2026-08-28). Owner, on a Jodah board: "cards are pulling each other too much
 *  which makes them clutter". Measured, and they are right — the springs were winning against the
 *  charge, so a dense deck settled as one clump with its edges crossing each other.
 *
 *  Six fixtures x ten seeds, at the shipped ALPHA_DECAY:
 *
 *    fixture       crossings 25 -> 60      rms link-dist error     nearest-neighbour gap
 *    sorin          40940 -> 36435 (-11%)      80 -> 80
 *    inalla         40679 -> 26347 (-35%)      60 -> 63                  49 -> 51
 *    fairdrazi      35913 -> 27767 (-23%)      65 -> 73                  50 -> 52
 *    changelings     7768 ->  6664 (-14%)      43 -> 57
 *    braids         26517 -> 17030 (-36%)      50 -> 63
 *    mdfc           77695 -> 62644 (-19%)      60 -> 66                  76 -> 91
 *
 *  Card overlaps stay 0 on all six and the board still parks (motion under 0.3 px/tick).
 *
 *  WHAT IT COSTS IS THE ENCODING, and that is the reason not to go further. Link-distance error is
 *  how well "closer means stronger synergy" holds, and a stronger charge pushes every pair off its
 *  spring's rest length: +3 to +14 rms here. Weakening the springs instead (`linkStrengthK` x0.6 or
 *  x0.35, both measured) buys a little more space and costs far more of it — x0.6 with this charge
 *  reads distErr 82 on inalla against 63 — so the charge moved and the springs did not.
 *
 *  Bracketed originally on the ten-trial room harness (`2026-08-08-d3-migration-measurements.md`),
 *  whose room escapes and intrusions no longer exist; this re-bracket is against the drawing-quality
 *  metrics Task 6 replaced them with. The unit note below still applies: forceManyBody's law is
 *  inverse-LINEAR, so this number does not compare to the pre-d3 loop's 2200. */
export const REPULSION = 60;
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
/** THE BOARD SETTLES IN SEVEN SECONDS, NOT TWENTY-THREE (2026-08-28). At 0.005 the simulation
 *  reaches PARK_ALPHA (0.001) after ln(0.001)/ln(0.995) ~ 1,380 ticks -- 23 seconds at 60fps of
 *  visible drift after every analyze, which the owner reported as "you can see cards constantly
 *  shaking sometimes". At 0.010 it parks after ~690 ticks, about 11.5 s, and the last seconds of
 *  that are already under a pixel.
 *
 *  MEASURED, six fixtures x ten seeds, motion sampled over 180 ticks after an 800-tick settle
 *  (motion is mean px/tick, worst-case max in brackets; crossings summed over the ten trials):
 *
 *    fixture       motion 0.005      motion 0.010     crossings 0.005 -> 0.010
 *    sorin         19.72 (56.5)      0.32 (0.9)         40163 -> 40940   (+2%)
 *    inalla         6.55 (14.6)      0.10 (0.3)         36211 -> 40679  (+12%)
 *    fairdrazi         -             0.12 (0.3)         35195 -> 35913   (+2%)
 *    changelings       -             0.05 (0.2)          7413 ->  7768   (+5%)
 *    braids            -             0.05 (0.3)         23686 -> 26517  (+12%)
 *    mdfc           8.10 (25.1)      0.14 (0.4)         74877 -> 77695   (+4%)
 *
 *  Under a pixel of drift over three seconds on every fixture, against 56 px on sorin. Card
 *  overlaps go to 0 on all six -- a board that never stops creeping re-forms overlaps as it goes,
 *  the same effect ALPHA_FLOOR's own table below records. Crossings and rms link-distance error pay
 *  for it (+2% to +12%, distErr +1 to +4) and the caps are re-measured for exactly that.
 *
 *  0.015 was measured too and is NOT what ships: it stills the board no more visibly (0.00 against
 *  0.10-0.32 px/tick, both invisible) and costs twice as much -- braids +21% crossings against
 *  +12%, mdfc +11% against +4%.
 *
 *  NOT the levers, and both were measured before this one was picked: `velocityDecay` 0.14 -> 0.55
 *  also stills the board but costs +27% crossings on mdfc and +53% on inalla, and a `linkDistScale`
 *  knob (built, swept, deleted) did not widen the nearest-neighbour gap AT ALL -- 77-83 world units
 *  at every value -- while adding 18-35% crossings, because collide already sets local spacing and
 *  longer springs only fold the layout. */
export const ALPHA_DECAY = 0.010;
/** THE BOARD IS ALLOWED TO STOP (2026-08-20). This was 0.02 -- an `alphaTarget`, so alpha never
 *  decayed to rest and the board crept forever under a paint loop that never idled. The value was
 *  ported from the pre-d3 hand-rolled loop, whose own comment said "it FLOORS alpha and keeps
 *  ticking forever; it never stops": flooring alpha was the only thing keeping THAT loop alive.
 *  Under d3 nothing needs a warm simulation -- there is no node drag, and every other interaction
 *  moves the camera rather than the nodes.
 *
 *  MEASURED, five fixtures x five seeds, motion sampled over 60 ticks after the settle depth where
 *  the floor actually bites (at 800 ticks the two arms are within noise BY CONSTRUCTION, since
 *  (1 - ALPHA_DECAY)^800 ~ 0.018 is already at the old floor):
 *
 *    fixture      settle   arm          cardOverlaps  crossings  distErr  mean px/tick  worst px/s
 *    sorin         4000    floor 0.02       11.4        4140       75       0.1479        79.4
 *    sorin         4000    floor 0            0.0        4061       76       0.0000         0.0
 *    sorin        20000    floor 0.02         2.4        4154       75       0.1550        77.3
 *    sorin        20000    floor 0            0.0        3946       76       0.0000         0.0
 *    fairdrazi     4000    floor 0.02         2.2        3942       62       0.0485        13.5
 *    fairdrazi     4000    floor 0            0.0        3548       61       0.0000         0.0
 *    inalla        4000    floor 0.02         0.0        3061       56       0.0280         5.8
 *    inalla        4000    floor 0            0.0        3184       55       0.0000         0.0
 *    braids       20000    floor 0.02         0.2        2228       45       0.0188         5.0
 *    braids       20000    floor 0            0.0        2417       47       0.0000         0.0
 *    changelings  20000    floor 0.02         0.0         710       42       0.0337         7.4
 *    changelings  20000    floor 0            0.0         730       41       0.0000         0.0
 *
 *  Motion goes to EXACTLY zero and quality does not degrade -- card overlaps reach 0.0 on all five,
 *  and the old arm's overlaps RE-FORM as the board keeps creeping (sorin 11.4 pairs at 4,000 ticks
 *  against 2.4 at 20,000: the number is a moving target because the board is). Crossings -10% to
 *  +5%, rms link-distance error +-2.
 *
 *  IT IS STILL A KNOB, and the tuner can put the floor back -- `BoardParams.alphaFloor`. What it
 *  must NOT become is a way to keep a board warm for an editor: energy belongs injected by an EVENT
 *  (`simulation.alpha(x).restart()` on a deck mutation, which the layout effect already does at
 *  0.3 on a graph change), not leaked continuously. → roadmap H1, measurements/graph-2026-08-20 */
export const ALPHA_FLOOR = 0;

/** The alpha at or below which the board is PARKED: no tick, no repaint until something invalidates.
 *
 *  This is d3-force's OWN default `alphaMin`, restated as a named constant rather than read off the
 *  simulation. The board drives `tick()` by hand, so d3 never consults its own alphaMin and the value
 *  had no effect on anything; naming it here gives the stop condition one home next to
 *  `ALPHA_FLOOR`, and keeps the paint loop from depending on a method the test stubs of
 *  `createBoardSimulation` do not implement. With `ALPHA_FLOOR` at 0 the alpha really does decay
 *  through this, which is the whole reason parking is reachable at all — H1 is the prerequisite.
 *  → roadmap H11 */
export const PARK_ALPHA = 0.001;
/** THE ENERGY A DECK CHANGE GETS (roadmap H9). A from-scratch board gets `alpha(1)`; a board that
 *  already has settled positions only needs enough for what CHANGED to find its place, and this was
 *  0.3 — a number nobody had measured.
 *
 *  MEASURED (board-edit.harness.ts, five fixtures, hub/median/leaf, add and remove): at 0.3 an edit
 *  displaces pre-existing cards by a p95 of 100-1,100 world units, against a card diagonal of 48.2.
 *  **The edit is not what does it — the REHEAT is**: reheating a settled board while changing
 *  NOTHING moves it nearly as far (sorin p95 866.6 against 1107.4 for removing a 54-degree hub), and
 *  removing a DEG-0 LEAF moved that board 700 units. Drift was ruled out: subtracting the
 *  common-mode translation changes the figures by under 1%.
 *
 *  At 0.05 the same edits displace 2-5x less (inalla median card 433.9 → 69.3, braids median
 *  99.8 → 21.3), and the two things a gentler reheat could break are both measured and fine:
 *  a newly added card still travels 70-100 units from its neighbours'-centroid seed and lands
 *  **overlapping nothing**, and the bulk case the product actually performs — the LANDS chip
 *  revealing ~31 nodes at once — settles with **zero lands overlapping and zero stuck at their
 *  seed** on all five fixtures, while halving the disturbance to the rest of the board
 *  (fairdrazi p95 464.9 → 208.7, sorin 334.4 → 127.1).
 *
 *  `sorin` stays over the criterion at every value (386 at 0.05): a sparse, orphan-heavy board
 *  propagates a change furthest, and no reheat setting fixes that. Recorded, not tuned around. */
export const EDIT_REHEAT_ALPHA = 0.05;

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
