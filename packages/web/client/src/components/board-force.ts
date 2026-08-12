import {
  forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type Simulation,
} from "d3-force";
import { ART_RADIUS, COLLISION_PAD, roomLayout } from "./deck-rooms.js";
import type { Circle, RoomId, RoomTally } from "./deck-rooms.js";
import type { GraphNode } from "../types.js";

/** A graph node as the force simulation sees it. `index` is written by d3-force itself when the
 *  node array is bound to a simulation; it is not ours to set. */
export interface Sim extends GraphNode {
  x: number; y: number; vx: number; vy: number; deg: number; index?: number;
}

/** The radius a node is DRAWN at, in world units. Every consumer -- the repulsion sweep, the edge
 *  springs, hit-testing, the label collision pass -- reads this one function, so the simulated size
 *  and the painted size cannot drift apart. They did: cards simulated at 3.5 while their art painted
 *  at ART_RADIUS (14), so nodes settled until they touched at ~7px apart and were then drawn four
 *  times that size. That mismatch is what made the graph unreadable. */
export function nodeRadius(n: { kind: string; deg: number }): number {
  return n.kind === "card" ? ART_RADIUS : Math.min(3 + Math.sqrt(n.deg) * 1.5, 15);
}

/** Velocity delta pulling one card toward another they share rooms with. Returned value applies to
 *  the first node; the second gets its negation. Linear in distance and in how many rooms the pair
 *  shares, so a card sharing two rooms with a neighbour sits nearer than one sharing one.
 *
 *  Zero for a pair sharing nothing -- those are handled by the repulsion that already exists, and
 *  adding a second repulsion term here would double-count it. */
export function roomAttraction(
  dx: number, dy: number, shared: number, stiffness: number,
): { x: number; y: number } {
  if (shared <= 0) return { x: 0, y: 0 };
  const d = Math.hypot(dx, dy);
  // Coincident cards have no direction to pull along, and separation() will part them next tick.
  if (d === 0) return { x: 0, y: 0 };
  const f = d * stiffness * shared;
  return { x: -(dx / d) * f, y: -(dy / d) * f };
}

/** Velocity delta pulling a card back toward a room it BELONGS to but has drifted outside of.
 *  Zero while the card is inside. `dx`/`dy` run from the room's centre to the card.
 *
 *  Velocity, not a positional snap like separation(): a card in five rooms gets five of these in
 *  one tick and has to settle to a compromise rather than vibrate between irreconcilable demands.
 *
 *  "Outside" is read off the card's FAR rim (d + cardR > roomR), the same conservative reading the
 *  enclosing-circle construction used before roomRadius replaced it. */
export function containment(
  dx: number, dy: number, roomR: number, cardR: number, stiffness: number,
): { x: number; y: number } {
  const d = Math.hypot(dx, dy);
  // A card exactly on the centre has no direction to act along -- same case roomAttraction
  // already handles for coincident cards.
  if (d === 0) return { x: 0, y: 0 };
  const depth = d + cardR - roomR;
  if (depth <= 0) return { x: 0, y: 0 };
  const f = depth * stiffness;
  // `+ 0` normalizes -0 to 0 (IEEE 754: -0 + 0 === 0): a zero dx or dy component would otherwise
  // negate to -0, which reads as equal to 0 by value but fails Object.is-based assertions.
  return { x: -(dx / d) * f + 0, y: -(dy / d) * f + 0 };
}

/** Velocity delta pushing a card OUT of a room it does not belong to. Zero while it is outside.
 *  The term that has never existed: roomAttraction is card-to-card and fires on rooms two cards
 *  SHARE, so nothing in the tick loop has ever read "this card is not in this room" and a
 *  non-member drifting into a circle was completely unopposed.
 *
 *  "Inside" is read off the card's NEAR rim (d - cardR < roomR), while containment reads the FAR
 *  rim (d + cardR > roomR). Those conditions OVERLAP in a band of width 2*cardR straddling the
 *  rim, where both would fire -- which never happens, because a card is a member XOR a non-member
 *  of any given room and exactly one of the two applies per card-room pair.
 *
 *  Its stiffness MUST stay below containment's: the reverse expels cards from every room at once
 *  and the board falls apart. */
export function foreignPush(
  dx: number, dy: number, roomR: number, cardR: number, stiffness: number,
  /** How far PAST the rim the push still reaches, in world units. 0 is the original behaviour:
   *  purely reactive, acting only once a card is already inside a room it does not belong to. A
   *  margin makes it anticipatory, resisting the approach instead of only the trespass. */
  margin: number = 0,
): { x: number; y: number } {
  const d = Math.hypot(dx, dy);
  if (d === 0) return { x: 0, y: 0 };
  const depth = roomR + margin - (d - cardR);
  if (depth <= 0) return { x: 0, y: 0 };
  // Ramped by how far in it actually is, so a card merely inside the margin is nudged and one deep
  // inside the circle is shoved. Without this the margin would apply full strength at first touch.
  const f = Math.min(depth, roomR + cardR) * stiffness;
  return { x: (dx / d) * f, y: (dy / d) * f };
}

/** How many times the projection pass may sweep the board in one tick before giving up.
 *
 *  NOT a tuning knob and not a compromise on the rule -- a bound on work per frame. A legal
 *  position always exists (finitely many discs never cover the plane), but reaching one can take
 *  many passes: a card in a large overlap is pushed out of A into B and back, moving only its
 *  penetration depth each time, and every pass is O(cards x circles) inside a frame that also has
 *  to paint. The circles move between frames too, so a board can be re-disturbed as fast as it is
 *  resolved. Stop at the ceiling, count what is left, and spend another 64 next frame. */
export const PROJECTION_PASSES = 64;

/** How far past a rim counts as past it, in world units. A card is moved to LAND on the rim, and
 *  `d + cardR` recomputed from the moved position lands a few ulps either side of the radius -- so
 *  without slack a satisfied card reads as violating by ~1e-14, gets moved again, and reports
 *  `moved` on every one of the 64 passes. Measured: it burned the whole ceiling and reported both
 *  cards of a settled two-card board unresolved.
 *
 *  1e-6 world units is ~1e-8 of a card radius: far below a pixel at any zoom this board reaches,
 *  and many orders of magnitude above the residue it exists to absorb. */
const RIM_SLACK = 1e-6;

/** The same question asked of the DRAWN board rather than of the pass, and it needs a much larger
 *  number. RIM_SLACK absorbs float residue against the geometry the pass was handed; this absorbs
 *  the circles MOVING between the pass and the report, which they do because the pass just moved
 *  their members. That residue is physical, not floating-point: measured worst case ~0.002 world
 *  units on a card ejected to land exactly on a rim.
 *
 *  0.1 world units is 0.7% of a card's 14-unit radius -- sub-pixel until about 10x zoom, which is
 *  well past where anyone reads room membership. Measured across both fixtures, all five presets,
 *  ten seeds: 261 violations at RIM_SLACK, of which 161 are shallower than this and 100 are not.
 *  So it removes the residue class without softening the metric into a budget -- the deep
 *  violations, the ones a viewer can actually see, all survive it.
 *
 *  The PASS is deliberately not given this slack. It should keep pushing on a violation it can
 *  still fix; only the report should decline to call 0.002 units a misplaced card. */
const REPORT_SLACK = 0.1;

/** Enforces room membership positionally: no card sits inside a room it does not belong to, and a
 *  card belonging to EXACTLY ONE room sits inside that one. Reports what it could not satisfy.
 *
 *  A POSITIONAL pass, deliberately: d3 runs forces before integration (`force(alpha)` writes vx,
 *  then `x += vx`), so a force can only ask. foreignPush and containment ask; this enforces. It is
 *  the same technique the pre-d3 separation() used for disc overlap and for the same stated reason
 *  -- a velocity nudge lets things pass through each other for several frames, which is fine for a
 *  preference and useless for a guarantee.
 *
 *  Runs AFTER simulation.tick(), from GraphView's own rAF loop, which is the only place that is
 *  after integration.
 *
 *  BOTH DIRECTIONS, and the measurement is why. Ejecting non-members alone drags single-room cards
 *  out of their OWN rooms as it goes: escapes.one went 0 -> 54 across ten trials, at every arm of
 *  the FOREIGN_PUSH sweep (0.008 down to 0.0005) and at 8x the pass ceiling, while intrusions only
 *  reached 3. Pulling a single-room card back in is the other half of the same constraint, and
 *  with both halves every hard condition holds at once: escapes.one 0, overlaps 0, intrusions 0,
 *  escapes.two 55 -> 41. See 2026-08-08-d3-migration-measurements.md.
 *
 *  ONLY single-room cards are pulled back. A card in two rooms whose circles do not overlap has no
 *  legal position at all, and hard-projecting it would make it oscillate between irreconcilable
 *  demands -- which is exactly what escapes.two being a SOFT metric already concedes. Those cards
 *  keep the containment force and nothing more.
 *
 *  MUTATES x/y and vx/vy on the cards it moves. The velocity component pointing back into the
 *  violation is removed or the next tick undoes the move and the card buzzes on the rim at frame
 *  rate; the tangential component survives, so a card can still slide around a rim it is pressed
 *  against.
 *
 *  Rooms are recomputed from member positions every tick (roomLayout), so a circle can sweep over
 *  a card that never moved -- "cannot enter" is not enforceable by the intruder alone, which is
 *  why this exists at all rather than a stronger foreignPush.
 *
 *  The geometry the PASSES run against is a snapshot, taken once at entry and fixed for the whole
 *  call. Recomputing between passes would chase its own tail -- moving a member moves its room's
 *  circle, which re-violates the member -- so the passes need something that holds still.
 *
 *  The COUNT is not taken against that snapshot, and this is the whole reason `circlesOf` is a
 *  function. Reporting against the entry snapshot describes a board nobody draws: the pass has
 *  moved members by then, so their rooms have moved too. Measured on Sorin's Subtype preset,
 *  ten trials at 800 and at 2400 ticks: the snapshot reading said 20 cards were unplaced while
 *  the circles as actually drawn contained ZERO illegal cards, and the gap did not shrink with
 *  settling because it was never about settling. Inalla said 12 against the same 0.
 *
 *  So: passes against the snapshot, count against a fresh recompute. One extra roomLayout per
 *  call, on a function already doing up to 64 passes over every card.
 *
 *  ONE GEOMETRY IT CANNOT SOLVE, by construction rather than by budget: a card exactly on the line
 *  joining two overlapping centres. Both pushes are along that line, so it is thrown from A to B
 *  and back at the same two positions forever, while every legal position is off the line. It is
 *  reported unresolved rather than special-cased -- the next frame's circles are recomputed from
 *  member positions, so the symmetry is gone as soon as anything else on the board moves.
 *
 *  Returns 0 when it converged, else the number of cards still illegal at the ceiling. */
export function projectRoomMembership(
  cards: readonly Sim[],
  circlesOf: () => ReadonlyMap<RoomId, Circle>,
  roomsByNode: ReadonlyMap<string, readonly RoomId[]>,
  maxPasses: number = PROJECTION_PASSES,
): number {
  const circles = circlesOf();
  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = false;
    for (const n of cards) {
      const mine = roomsByNode.get(n.id);
      // Same skip forceRoomContainment makes: a card claiming no room makes no claim about where
      // it should NOT be either.
      if (!mine || mine.length === 0) continue;
      const cardR = nodeRadius(n);

      for (const [id, c] of circles) {
        if (mine.includes(id)) continue;
        const dx = n.x - c.x, dy = n.y - c.y;
        const d = Math.hypot(dx, dy);
        // A card exactly on the centre has no direction to leave along. +x is arbitrary but
        // deterministic; skipping would leave an intrusion standing, which is the one outcome
        // this function exists to prevent.
        const [ux, uy] = d === 0 ? [1, 0] : [dx / d, dy / d];
        // NEAR rim, matching foreignPush, so the soft force and the hard pass agree about "inside".
        const depth = c.r - (d - cardR);
        if (depth <= RIM_SLACK) continue;
        n.x += ux * depth;
        n.y += uy * depth;
        const vn = n.vx * ux + n.vy * uy;
        if (vn < 0) { n.vx -= vn * ux; n.vy -= vn * uy; }
        moved = true;
      }

      if (mine.length === 1) {
        const c = circles.get(mine[0]);
        // FAR rim, matching containment, for the same reason the ejection matches foreignPush.
        const out = c ? Math.hypot(n.x - c.x, n.y - c.y) + cardR - c.r : 0;
        if (c && out > RIM_SLACK) {
          const dx = n.x - c.x, dy = n.y - c.y;
          const d = Math.hypot(dx, dy);
          // d is never 0 here: out > 0 with d == 0 would need cardR > c.r, a card bigger than the
          // room drawn around it, and roomRadius is area-derived from a member count of at least
          // one. Guarded anyway rather than dividing by zero on a future radius rule.
          if (d > 0) {
            const ux = dx / d, uy = dy / d;
            n.x -= ux * out;
            n.y -= uy * out;
            const vn = n.vx * ux + n.vy * uy;
            if (vn > 0) { n.vx -= vn * ux; n.vy -= vn * uy; }
            moved = true;
          }
        }
      }
    }
    // BREAK, not `return 0`. Converging means nothing is left to move against the ENTRY snapshot,
    // which is not the same as being legal against the circles that get drawn -- and the drawn
    // geometry is what the count below is for. Returning here skipped that check on exactly the
    // frames that looked healthiest, and hid 58 of inalla's 115 unplaced cards over ten seeds.
    if (!moved) break;
  }

  // The circles as they will be DRAWN, recomputed from where the passes above left the members.
  const drawn = circlesOf();
  let unresolved = 0;
  for (const n of cards) {
    const mine = roomsByNode.get(n.id);
    if (!mine || mine.length === 0) continue;
    const cardR = nodeRadius(n);
    // Counts CARDS, not violations: one card in three foreign circles is one card the pass could
    // not place, and the panel row reads as "how many cards are wrong".
    let illegal = false;
    for (const [id, c] of drawn) {
      if (mine.includes(id)) continue;
      if (c.r - (Math.hypot(n.x - c.x, n.y - c.y) - cardR) > REPORT_SLACK) { illegal = true; break; }
    }
    if (!illegal && mine.length === 1) {
      const c = drawn.get(mine[0]);
      // The pass promises both halves, so it has to own both halves in what it reports.
      if (c && Math.hypot(n.x - c.x, n.y - c.y) + cardR - c.r > REPORT_SLACK) illegal = true;
    }
    if (illegal) unresolved++;
  }
  return unresolved;
}

/** Translates the whole board so the CARDS' centroid sits on the world origin. Called once a frame,
 *  it holds the board still.
 *
 *  The board walks because nothing anchors the cards: `forceX`/`forceY` claim only UNZONED nodes --
 *  which is every non-card node and no roomed card -- and every other force is pairwise or
 *  room-relative, so a common-mode motion is invisible to all of them. Measured on Sorin's Colour
 *  preset: 67 world units of card-centroid drift every 3 s across ten trials, ~1,300 a minute. The
 *  board leaves the screen and does not come back, because the camera deliberately keeps the user's
 *  pan across a preset change (GraphView).
 *
 *  POSITIONAL, and that is the entire point. A FORCE cannot fix this: d3 runs `force(alpha)` to
 *  write vx, then integrates, so a velocity-based cancellation never sees projectRoomMembership,
 *  which runs AFTER integration and moves cards by hand. That was measured, not reasoned: a force
 *  subtracting the cards' mean velocity took Colour's drift 67 -> 25 and stalled there, while this
 *  pass takes it to 0.00 on every preset. The force was then deleted -- with the pass in place it
 *  moved nothing (Role 3->0 overlaps, Subtype 12->10 intrusions, both inside trial noise). Same
 *  division of labour as containment/foreignPush (ask) versus projectRoomMembership (enforce).
 *
 *  The ORIGIN, not a remembered anchor, because that is where the camera already looks: the first
 *  layout seeds d3-zoom with `translate(dim.w / 2, dim.h / 2)` (GraphView), which frames world
 *  (0, 0). Pinning there needs no state and cannot drift itself.
 *
 *  Moves EVERY node, cards included. Translating cards alone would tear them off the ~234 non-card
 *  nodes they hang from by roughly 1,300 link springs, and the springs would pull them back next
 *  tick -- the board would fight itself once a frame.
 *
 *  A rigid translation changes no distance between any two nodes, so no room circle, no overlap, no
 *  escape and no intrusion can change: room geometry is derived from member positions and moves with
 *  them. It is invisible to every acceptance metric, which is what makes it free.
 *
 *  MUTATES x/y. Velocity is deliberately untouched -- the board's internal settling is not this
 *  pass's business, and zeroing it here would fight the simulation. */
export function holdCardCentroid(nodes: readonly Sim[], cards: readonly Sim[]): void {
  if (cards.length === 0) return;
  let sx = 0, sy = 0;
  for (const n of cards) { sx += n.x; sy += n.y; }
  const dx = sx / cards.length, dy = sy / cards.length;
  if (dx === 0 && dy === 0) return;
  for (const n of nodes) { n.x -= dx; n.y -= dy; }
}

/** Escapes and intrusions on a settled layout, from what __graphProbe() reports.
 *
 *  An ESCAPE is a card outside a room it belongs to, bucketed by how many rooms the card is in:
 *  the 1-room bucket should reach 0, while the 3+ bucket is where geometry runs out (circles
 *  cannot realise an arbitrary Euler diagram past three sets) and a nonzero number there is the
 *  expected result, not a failure. An INTRUSION is a card inside a room it does not belong to --
 *  unopposed until foreignPush existed.
 *
 *  Both read a card's CENTRE against the circle, not its rim: this is a scoring rule for how well
 *  the layout settled, deliberately looser than the rim readings containment and foreignPush act
 *  on, so a card one pixel proud of a rim does not count as having escaped. */
export function boardMetrics(
  cards: readonly { x: number; y: number; rooms: readonly string[] | null }[],
  circles: readonly { id: string; x: number; y: number; r: number }[],
): { escapes: { one: number; two: number; threePlus: number }; intrusions: number } {
  const escapes = { one: 0, two: 0, threePlus: 0 };
  let intrusions = 0;
  for (const card of cards) {
    const mine = card.rooms ?? [];
    for (const c of circles) {
      const inside = Math.hypot(card.x - c.x, card.y - c.y) <= c.r;
      if (mine.includes(c.id)) {
        if (inside) continue;
        if (mine.length === 1) escapes.one++;
        else if (mine.length === 2) escapes.two++;
        else escapes.threePlus++;
      } else if (inside) intrusions++;
    }
  }
  return { escapes, intrusions };
}

/** Pairs of card discs that visibly overlap -- centres closer than two art radii. One of the two
 *  HARD acceptance conditions for a settled board (the other is escapes.one), and the same rule the
 *  ten-trial harness used, so a number read off the tuning panel is comparable with the table in
 *  2026-08-08-d3-migration-measurements.md.
 *
 *  Takes CARDS only. Non-card nodes are drawn at a radius that varies with degree and are allowed
 *  to sit anywhere; feeding them in would count crowding that is not a defect.
 *
 *  O(n^2) over ~94 cards, called four times a second by the panel -- immaterial, and far cheaper
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

/** How fast a crowded room grows, per tick, as a fraction of its base radius. */
export const BREATHE_GROW = 0.004;
/** How fast an uncrowded room returns toward its base radius. Slower than it grows, deliberately:
 *  a room that has just stopped colliding stops because it is currently big enough, and shrinking
 *  at the same rate it grew would put it straight back into collision. Asymmetry is what makes the
 *  loop settle instead of hunting. */
export const BREATHE_DECAY = 0.001;
/** Ceiling on the multiplier. 1.5 is 2.25x the area, equivalent to PACK ~0.22, past the point where
 *  the measured PACK sweep stopped buying anything on any fixture. A room that wants more than this
 *  has a problem more area will not fix. */
export const BREATHE_MAX = 1.5;
/** Breathing is OFF above this alpha. Early in a run every room is colliding -- the board starts as
 *  a ring of cards and sorts itself out -- so without this gate every room inflates during the
 *  chaotic phase and then holds it, because decay is deliberately slower than growth. Measured
 *  ungated: braids/Colour overlaps 253 -> 1, but three boards that were clean lost their zero and
 *  fairdrazi/Colour intrusions went 44 -> 55. Crowding only means something once the layout has
 *  stopped rearranging itself. */
export const BREATHE_ALPHA = 0.1;

/** Lets a room whose members are actually colliding GROW, and settle back when they stop.
 *
 *  roomRadius sizes a circle from its member COUNT alone, at a fixed 50% occupancy (PACK), so it
 *  cannot tell a room whose cards have settled comfortably from one the projection is stacking
 *  cards inside. Measured by sweeping PACK, ten trials: more area annihilates the worst case --
 *  braids/Colour overlaps 253 -> 0 at PACK 0.35 -- but applied GLOBALLY it costs everywhere it was
 *  not needed, because bigger circles overlap each other more: sorin/Colour 31 -> 50 overlaps,
 *  fairdrazi/Colour intrusions 44 -> 74, and inalla/Role stops being clean at all. That is the
 *  monotone trade PACK's own comment records.
 *
 *  So the area is spent per room, where the collisions actually are. This force moves nothing; it
 *  is registered only because a d3 force runs exactly once per tick, which is the cadence the
 *  update needs -- roomCircles() is called several times a frame and must stay a pure read.
 *
 *  ONE overlap sweep, attributed to rooms rather than one sweep per room: a colliding pair grows
 *  every room both cards share, which is the set of rooms that could be holding them together. */
export function forceRoomBreathing(opts: {
  roomsByNode: ReadonlyMap<string, readonly RoomId[]>;
  slack: Map<RoomId, number>;
  grow: number;
  decay: number;
  max: number;
  alpha: number;
}): CustomForce {
  let cards: Sim[] = [];
  const force = ((alpha: number) => {
    // Above this the board is still sorting itself out and every room looks crowded.
    if (alpha > opts.alpha) return;
    const crowded = new Set<RoomId>();
    for (let i = 0; i < cards.length; i++) {
      const a = cards[i];
      const ra = opts.roomsByNode.get(a.id);
      if (!ra || ra.length === 0) continue;
      for (let j = i + 1; j < cards.length; j++) {
        const b = cards[j];
        const rb = opts.roomsByNode.get(b.id);
        if (!rb || rb.length === 0) continue;
        const want = nodeRadius(a) + nodeRadius(b);
        if (Math.hypot(a.x - b.x, a.y - b.y) >= want) continue;
        for (const id of ra) if (rb.includes(id)) crowded.add(id);
      }
    }
    for (const [id, value] of opts.slack) {
      if (!crowded.has(id)) opts.slack.set(id, Math.max(1, value - opts.decay));
    }
    for (const id of crowded) {
      opts.slack.set(id, Math.min(opts.max, (opts.slack.get(id) ?? 1) + opts.grow));
    }
  }) as CustomForce;
  force.initialize = (nodes: Sim[]) => { cards = nodes.filter((n) => n.kind === "card"); };
  return force;
}

/** A d3-force custom force: a function of the current alpha, plus the `initialize` hook
 *  `simulation.force(name, f)` calls to hand it the node array. */
export type CustomForce = ((alpha: number) => void) & { initialize(nodes: Sim[]): void };

/** Cards sharing a room pull together; the room's circle is then drawn around the cluster they
 *  form. The only force that reads membership pairwise.
 *
 *  EACH ROOM'S PULL IS NORMALISED BY ITS OWN SIZE, and that is what removed the universal-room
 *  exemption this force used to carry. The pull is a linear spring per PAIR, so a card in an
 *  n-member room felt n-1 of them and its total inward force scaled with n, while the repulsion
 *  pushing back falls off with distance. Past some size attraction simply won, and a room holding
 *  most of the deck collapsed into a pile -- which is what UNIVERSAL_ROOM_FRACTION was built to
 *  dodge, by switching the room's attraction off entirely above 80% of the deck.
 *
 *  Switching it off has its own failure, and it is visible rather than measurable: with nothing
 *  pulling inward, repulsion spreads the members until containment stops them at the rim, and a
 *  mono-black deck's Colour board draws as a HOLLOW RING of 65 cards around an empty middle. Zero
 *  overlaps, zero intrusions, and nobody would want it. Both the pile and the ring are the same
 *  bug seen from either side: a force whose strength depends on how many cards happen to share a
 *  room.
 *
 *  Weighting each shared room by 1/(members - 1) makes a card's total room pull roughly one
 *  spring's worth whatever the room's size, so a 67-card room pulls about as hard as a 3-card one
 *  and neither extreme arises. No threshold, no exemption, no second failure mode to guard.
 *
 *  Deliberately not expressed as a forceLink over same-room pairs: forceLink splits its
 *  correction by a degree bias (`count[source] / (count[source] + count[target])`, see the
 *  design doc's 3.3), which would make a card in five rooms move differently from one in one
 *  room for reasons that have nothing to do with the rooms they share.
 *
 *  O(cards^2) per tick and left that way: 94 cards is 4,371 pairs, immaterial beside the
 *  quadtree repulsion running alongside it. */
export function forceRoomAttraction(opts: {
  roomsByNode: ReadonlyMap<string, readonly RoomId[]>;
  stiffness: number;
}): CustomForce {
  let cards: Sim[] = [];
  /** 1 / members, per room. See the note above: this is what stops a room's pull scaling with its
   *  own size, and it is why there is no universal-room exemption any more. */
  let weight = new Map<RoomId, number>();
  const force = ((alpha: number) => {
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i], b = cards[j];
        const ra = opts.roomsByNode.get(a.id), rb = opts.roomsByNode.get(b.id);
        if (!ra || !rb) continue;
        let shared = 0;
        for (const id of ra) if (rb.includes(id)) shared += weight.get(id) ?? 1;
        if (shared === 0) continue;
        // alpha scales the force, not the integration step -- that is d3's convention and the
        // one difference from the loop this replaces (design doc 3).
        const t = roomAttraction(a.x - b.x, a.y - b.y, shared, opts.stiffness * alpha);
        a.vx += t.x; a.vy += t.y;
        b.vx -= t.x; b.vy -= t.y;
      }
    }
  }) as CustomForce;
  force.initialize = (nodes: Sim[]) => {
    cards = nodes.filter((n) => n.kind === "card");
    const size = new Map<RoomId, number>();
    for (const n of cards) {
      for (const id of opts.roomsByNode.get(n.id) ?? []) size.set(id, (size.get(id) ?? 0) + 1);
    }
    weight = new Map([...size].map(([id, n]) => [id, 1 / Math.max(1, n - 1)]));
  };
  return force;
}

/** Rooms hold their members in and push non-members out.
 *
 *  `circles` is a thunk, not a value: the circles are placed on their members' centroids, so
 *  they move as the layout settles and must be recomputed every tick.
 *
 *  `foreignStiffness` MUST stay below `containmentStiffness`. The reverse expels cards from
 *  every room at once and the board falls apart. */
export function forceRoomContainment(opts: {
  roomsByNode: ReadonlyMap<string, readonly RoomId[]>;
  circles: () => ReadonlyMap<RoomId, Circle>;
  containmentStiffness: number;
  foreignStiffness: number;
  /** Optional, default 0 -- the original purely-reactive push. */
  foreignMargin?: number;
}): CustomForce {
  let cards: Sim[] = [];
  const force = ((alpha: number) => {
    const circles = opts.circles();
    for (const n of cards) {
      const mine = opts.roomsByNode.get(n.id);
      // A card in NO room makes no claim about where it should NOT be either. Skip the circle
      // loop entirely rather than special-casing foreignPush -- without this it takes
      // foreignPush from ALL circles at once and is flung off the board (measured: 14/94 cards,
      // 275-371 units past the nearest rim, on inalla.txt's Colour preset).
      if (!mine || mine.length === 0) continue;
      const cardR = nodeRadius(n);
      for (const [id, c] of circles) {
        const dx = n.x - c.x, dy = n.y - c.y;
        const t = mine.includes(id)
          ? containment(dx, dy, c.r, cardR, opts.containmentStiffness * alpha)
          : foreignPush(dx, dy, c.r, cardR, opts.foreignStiffness * alpha, opts.foreignMargin ?? 0);
        n.vx += t.x; n.vy += t.y;
      }
    }
  }) as CustomForce;
  force.initialize = (nodes: Sim[]) => { cards = nodes.filter((n) => n.kind === "card"); };
  return force;
}

/** Slides a room that sits ENTIRELY inside another off its parent's centre.
 *
 *  When every member of B is also a member of A, both circles are centred on the centroid of
 *  almost the same cards, so B lands on top of A's middle. A's own members then have to live in
 *  the annulus around it — and A's centre, which is where roomAttraction is pulling them, is the
 *  one place they are forbidden to be. Measured on inalla, where every Human, Faerie, Merfolk and
 *  Otter is also a Wizard: `[wizard] in foreign human` was the single largest unresolved family.
 *
 *  Fixing it by RESIZING was tried first and is recorded because it failed: growing A so the
 *  annulus is sized for A's own members took that family from 24 to 40 over ten seeds. More area
 *  does not help when the trouble is WHERE the free area is.
 *
 *  So move B instead. Each nested child gets a deterministic angle off its parent's centre and is
 *  pulled until its circle is internally tangent to the parent's rim (`A.r - B.r`), leaving A's
 *  members one contiguous crescent rather than a thin ring. Several children of one parent are
 *  spread evenly around it by index, so they do not stack on the same side.
 *
 *  The nudge is applied equally to every member of B, which TRANSLATES the cluster instead of
 *  compressing it: pulling each member individually toward the target point would squeeze B
 *  against its own roomAttraction. B's members are A's members too, so A's containment still holds
 *  them in and this only decides where inside A they sit.
 *
 *  Nesting is membership-derived and membership does not change during a run, so the plan is built
 *  once in `initialize` rather than every tick. */
export function forceNestedOffset(opts: {
  roomsByNode: ReadonlyMap<string, readonly RoomId[]>;
  circles: () => ReadonlyMap<RoomId, Circle>;
  stiffness: number;
}): CustomForce {
  let plan: { parent: RoomId; child: RoomId; angle: number; members: Sim[] }[] = [];
  const force = ((alpha: number) => {
    if (plan.length === 0) return;
    const circles = opts.circles();
    for (const p of plan) {
      const a = circles.get(p.parent), b = circles.get(p.child);
      if (!a || !b) continue;
      // A child at least as big as its parent has nowhere to go. Cannot happen for a STRICT subset
      // under an area-derived radius, but the radius rule is allowed to change.
      const gap = a.r - b.r;
      if (gap <= 0) continue;
      const dx = a.x + Math.cos(p.angle) * gap - b.x;
      const dy = a.y + Math.sin(p.angle) * gap - b.y;
      const k = opts.stiffness * alpha;
      for (const n of p.members) { n.vx += dx * k; n.vy += dy * k; }
    }
  }) as CustomForce;

  force.initialize = (nodes: Sim[]) => {
    const cards = nodes.filter((n) => n.kind === "card");
    const membersOf = new Map<RoomId, Sim[]>();
    for (const n of cards) {
      for (const id of opts.roomsByNode.get(n.id) ?? []) {
        const list = membersOf.get(id);
        if (list) list.push(n);
        else membersOf.set(id, [n]);
      }
    }
    // Smallest containing room only. A Faerie nested in both `wizard` and some larger room should
    // be placed relative to the tightest thing that contains it; being pulled toward two different
    // rims at once is how a card ends up satisfying neither.
    const parentOf = new Map<RoomId, RoomId>();
    for (const [child, theirs] of membersOf) {
      let best: RoomId | undefined, bestSize = Infinity;
      for (const [parent, ours] of membersOf) {
        // STRICTLY bigger, so two rooms with identical membership never adopt each other. Merging
        // is what handles that pair; this handles containment with room to spare.
        if (parent === child || ours.length <= theirs.length || ours.length >= bestSize) continue;
        const holds = new Set(ours);
        if (theirs.every((n) => holds.has(n))) { best = parent; bestSize = ours.length; }
      }
      if (best !== undefined) parentOf.set(child, best);
    }
    // Children of one parent spread evenly around it, ordered by id so the board is identical
    // across renders of one deck.
    const byParent = new Map<RoomId, RoomId[]>();
    for (const [child, parent] of parentOf) {
      const list = byParent.get(parent);
      if (list) list.push(child);
      else byParent.set(parent, [child]);
    }
    plan = [];
    for (const [parent, children] of byParent) {
      children.sort();
      children.forEach((child, i) => {
        plan.push({
          parent, child,
          angle: (i / children.length) * Math.PI * 2,
          members: membersOf.get(child) ?? [],
        });
      });
    }
  };
  return force;
}

/** Rest-length padding on an edge spring, on top of the two nodes' own radii. */
export const EDGE_GAP = 28;
/** Repulsion strength -- 2200 in the hand-rolled loop, 25 here, and the change is a UNIT change,
 *  not a retune. forceManyBody's law is inverse-LINEAR (k*alpha/d), not the loop's inverse-square
 *  (k/d^2); see the design doc's 3.1. At the ~33-unit spacing collision settles cards to, 1/d is
 *  ~33x stronger than 1/d^2 for the same k, and alpha scales the FORCE here rather than the
 *  integration step, so the loop's number could not carry across.
 *
 *  Bracketed on the ten-trial harness below (full table in
 *  `docs/superpowers/specs/2026-08-08-d3-migration-measurements.md`). Totals across ten trials:
 *
 *    2200 -> escapes.one 731, intrusions   0  -- board blown apart, every card outside its rooms
 *     220 -> escapes.one 260, intrusions   0
 *      70 -> escapes.one  14, intrusions   0
 *      40 -> escapes.one   1, intrusions   0  -- still fails the hard condition
 *      30 -> escapes.one   0, intrusions   5  -- PASSES
 *      25 -> escapes.one   0, intrusions  14  -- PASSES, chosen
 *      22 -> escapes.one   0, intrusions  26  -- PASSES
 *      10 -> escapes.one   0, intrusions 138  -- fails the intrusion cap
 *
 *  The trade is monotone and is the same one PACK already documents: weaker repulsion packs the
 *  board tighter, so escapes fall and intrusions rise. Overlaps were 0/10 at EVERY value tried,
 *  including 2200.
 *
 *  25 sits inside the measured failing bracket (40 above, 10 below) rather than being the first
 *  passing value the bisect landed on -- but do NOT read it as best-centred. The bisect was
 *  log-scaled, so the log-centre of [10, 40] is 20 and 25 is nearly twice as close to the failing
 *  side, which is also the steeper one (30 -> 0 escapes, 40 -> 1); and the lower bound is poorly
 *  localised, since nothing between 10 and 22 was tried. The claim this value carries is only that
 *  the passing band spans at least 10->30, a factor of three, so it is robust rather than fragile.
 *  The measurements doc has the full reasoning. */
export const REPULSION = 25;
/** How far repulsion reaches, in world units. Ported from the old loop's `d2 > 220000` cutoff,
 *  which is ~469 -- wider than any room on any fixture, so every card in a room repels every other
 *  one. That is what makes a large room draw as a HOLLOW RING: mutual repulsion inside a hard
 *  boundary concentrates at the edge, the way charge does on a conductor.
 *
 *  SHORTENING IT FILLS THE DISC AND BREAKS MEMBERSHIP. Measured by the share of a room's members
 *  sitting in the outer fifth of its radius -- a uniform fill puts 36% there, so 0.36 is the target
 *  and higher means ring:
 *
 *      range   braids/Colour   sorin/Colour   inalla/Role    what it costs
 *      469        0.58            0.57           0.69        nothing; this is shipped
 *      200        0.37            0.37           0.40        20 caps regressed vs 5 improved
 *      120        0.05            0.20           0.24        intrusions 5x-17x on four fixtures
 *       70        0.04            0.20           0.19        worse again
 *
 *  200 lands almost exactly on a uniform fill and is still rejected: at ten trials it regressed 20
 *  of the 25 cases' caps and improved 5, with intrusions the casualty everywhere -- fairdrazi/Colour
 *  28 -> 132, changelings/Colour 1 -> 22, sorin/Subtype 0 -> 17. Cards stop being pushed apart
 *  before they drift into a foreign room. Below 200 the layout over-collapses: an outer share of
 *  0.05 is not a filled disc, it is a clump in the middle of one.
 *
 *  So the ring is the price of membership under this force set, and it is a knob rather than a
 *  fixed number so the next attempt starts from the sweep instead of repeating it. Anything that
 *  makes shortening it affordable has to come from the membership side -- a foreignPush that
 *  reaches further than repulsion, say -- not from this constant alone. */
export const REPULSION_RANGE = 469;
/** Pull between two cards per room they share. NOT retuned: repulsion alone bought both hard
 *  conditions, and the protocol's stopping rule is to stop there. Carries the loop's measured
 *  value (Task 9 / Task 12 arm A3, which found 0 collapses the board). */
export const ROOM_ATTRACTION = 0.008;
/** How hard a room pulls a member back inside it, and how hard it pushes a non-member out. Both
 *  carried over unchanged from the loop (Task 12 arm A2b) and both left alone here for the same
 *  reason ROOM_ATTRACTION was. FOREIGN_PUSH < CONTAINMENT is a HARD CONSTRAINT, not a preference:
 *  the reverse expels cards from every room at once and the board falls apart. */
export const CONTAINMENT = 0.02;
export const FOREIGN_PUSH = 0.008;
/** How far past a foreign room's rim its push still reaches, in world units.
 *
 *  0 was the original behaviour and it is purely REACTIVE: foreignPush did nothing at all until a
 *  card was already inside a room it does not belong to, so the only thing keeping non-members out
 *  at range was general repulsion. A margin makes it anticipatory -- it resists the approach rather
 *  than only the trespass.
 *
 *  Swept across ten cases, ten trials each, totalled:
 *
 *      margin   overlaps   intrusions   unresolved
 *        0         48          36           94
 *       40         35          24           58     -- chosen
 *       90         53          13           64
 *
 *  40 is taken because it beats the reactive behaviour on ALL THREE at once, where 90 trades
 *  overlaps up to buy intrusions down. On the full 25-case gate it lowered 10 caps and raised 3,
 *  every rise by 2 counts.
 *
 *  IT DOES NOT RESCUE SHORT-RANGE REPULSION, which is what it was tried for. At REPULSION_RANGE
 *  200 the intrusions still blow up with a margin of 40 or 80 (fairdrazi/Colour 118, changelings
 *  /Colour 18-27) -- because shortening the range contracts the whole board and overlaps the ROOMS,
 *  which is not something a rim margin can reach. It shipped on its own merits instead. */
export const FOREIGN_MARGIN = 40;
/** How hard a nested room is slid off its parent's centre (forceNestedOffset). It trades against
 *  containment, which holds the child's members inside the parent while this decides WHERE inside.
 *
 *  Swept on inalla's Subtype preset -- the only nesting either fixture has -- 20 seeds per arm,
 *  totalled across them:
 *
 *      0     -> unresolved 95, intrusions 5, escapes.two 81, motionMean 39.6
 *      0.05  -> unresolved 72, intrusions 0, escapes.two 61, motionMean 34.2
 *      0.1   -> unresolved 50, intrusions 5, escapes.two 26, motionMean 26.9
 *      0.15  -> unresolved 55, intrusions 0, escapes.two 17, motionMean 29.6  -- chosen
 *      0.3   -> unresolved 84, intrusions 0, escapes.two 17, motionMean 24.0
 *      0.6   -> unresolved 36, intrusions 2, escapes.two  7, motionMean 18.8
 *
 *  READ escapes.two, NOT unresolved. escapes.two falls monotonically across the whole sweep and
 *  motionMean tracks it; unresolved swings 55 -> 84 -> 36 over three increasing values, which is
 *  noise, not a curve. Tuning on it would be fitting the seed.
 *
 *  0.15 takes 79% of the escapes.two gain (81 -> 17) and is the largest value where intrusions is
 *  still 0. The band above it was measured, not skipped: 0.6 does reach escapes.two 7, but buys it
 *  back on intrusions and confirms nothing on unresolved. ponytail: if nesting ever matters on a
 *  deck that is not inalla, re-sweep there before reaching for the higher band. */
export const NESTED_OFFSET = 0.15;
export const LINK_STIFFNESS = 0.0012;
export const CENTER_PULL = 0.0004;
/** d3's setter stores `1 - _`, so this yields the 0.86 retention the old VELOCITY_DAMPING had. */
export const VELOCITY_DECAY = 0.14;
export const ALPHA_DECAY = 0.005;
/** Today's loop FLOORS alpha and keeps ticking forever; it never stops. alphaTarget reproduces
 *  that, alphaMin would stop the simulation instead. See the design doc's 3. */
export const ALPHA_FLOOR = 0.02;
/** forceCollide is velocity-based where the positional separation() it replaces was not, so it
 *  converges on overlaps rather than guaranteeing they are gone -- the risk design 3.2 names, and
 *  the reason its ladder puts overlaps first in the tuning order.
 *
 *  It did not materialise. Zero overlapping card discs in 10/10 trials at EVERY REPULSION value
 *  tried, from 10 to 2200, with iterations at d3's default 1. So the ladder never left its first
 *  rung: iterations was never raised and the §3.2 positional-separation() fallback was never
 *  reached. Why it holds: integration is `x += vx *= 0.86` immediately after the force pass, so
 *  ~86% of the needed correction lands the same tick, and 800 ticks is thousands of chances to
 *  converge on a board whose alpha never actually reaches zero. */
export const COLLIDE_ITERATIONS = 1;

/** The ten constants above, as one object a caller can override. The constants themselves stay the
 *  source of truth -- this references them rather than restating their numbers, so the measurement
 *  comments above remain the only place a value is written down.
 *
 *  Exists for the dev tuning panel (BoardTuner). Nothing in the product passes `params`. */
export interface BoardParams {
  repulsion: number;
  repulsionRange: number;
  roomAttraction: number;
  containment: number;
  foreignPush: number;
  foreignMargin: number;
  nestedOffset: number;
  breatheGrow: number;
  linkStiffness: number;
  centerPull: number;
  velocityDecay: number;
  alphaDecay: number;
  alphaFloor: number;
  collideIterations: number;
}

export const DEFAULT_PARAMS: BoardParams = {
  repulsion: REPULSION,
  repulsionRange: REPULSION_RANGE,
  roomAttraction: ROOM_ATTRACTION,
  containment: CONTAINMENT,
  foreignPush: FOREIGN_PUSH,
  foreignMargin: FOREIGN_MARGIN,
  nestedOffset: NESTED_OFFSET,
  breatheGrow: BREATHE_GROW,
  linkStiffness: LINK_STIFFNESS,
  centerPull: CENTER_PULL,
  velocityDecay: VELOCITY_DECAY,
  alphaDecay: ALPHA_DECAY,
  alphaFloor: ALPHA_FLOOR,
  collideIterations: COLLIDE_ITERATIONS,
};

/** The whole board layout as one d3 simulation: repulsion, edge springs, disc collision, a centre
 *  pull for anything no room claims, and the two custom room forces above.
 *
 *  Returned STOPPED. GraphView's own requestAnimationFrame paint loop calls `tick()`; d3's internal
 *  d3-timer stepper would be a second loop running on a schedule independent of paint.
 *
 *  READ THIS BEFORE FILTERING BY VISIBILITY. `visible` gates the ROOM CIRCLES only -- which cards
 *  a room is drawn around. Every node in `nodes` takes part in charge/collide/link whether or not
 *  it is visible, because that is the array d3 binds its forces to. The hand-rolled loop this
 *  replaces filtered to visible nodes inside its tick instead, so a hidden node contributed
 *  nothing.
 *
 *  The hidden nodes are NOT inert scenery. On the inalla fixture, 252 of the 346 nodes are
 *  non-card, and they carry roughly 1,300 card<->non-card LINK SPRINGS -- most of the board's
 *  cohesion. Binding only cards (and only card<->card links, as GraphView's own loop does) is a
 *  measured ACCEPTANCE FAILURE at these constants, not a nicety: escapes.one 0 -> 3 across ten
 *  trials at 800 ticks, still 1 at 6000, and escapes.two 55 -> 168. Cards ESCAPE rather than pack
 *  tighter, because what is removed is cohesion, not repulsion.
 *
 *  (CENTER_PULL does not hold those nodes anywhere -- at 0.0004*alpha it is ~1e-5 per tick. An
 *  earlier version of this comment credited it and was wrong.)
 *
 *  So REPULSION 25 is measured with all 346 nodes live, and binding every node regardless of
 *  visibility is now the project owner's RULING (7585fca) rather than an accident of this code --
 *  taken on exactly those numbers. Do not add a visibility filter to the forces without re-tuning
 *  against the filtered board first; `visible` is for the room circles and nothing else.
 *  See `2026-08-08-d3-migration-measurements.md`. */
export function createBoardSimulation(opts: {
  nodes: Sim[];
  links: { source: Sim; target: Sim }[];
  roomsByNode: ReadonlyMap<string, readonly RoomId[]>;
  rooms: readonly { id: RoomId }[];
  tallies: Map<RoomId, RoomTally>;
  visible: (n: Sim) => boolean;
  params?: Partial<BoardParams>;
}): { simulation: Simulation<Sim, undefined>; roomCircles: () => Map<RoomId, Circle> } {
  const p = { ...DEFAULT_PARAMS, ...opts.params };
  // Per-room radius multipliers, updated once a tick by forceRoomBreathing below. Lives here rather
  // than inside roomLayout because roomLayout is a pure function of positions and must stay one --
  // roomCircles() is called several times a frame.
  const slack = new Map<RoomId, number>(opts.rooms.map((r) => [r.id, 1]));
  const roomCircles = () =>
    roomLayout(
      opts.nodes
        .filter((n) => n.kind === "card" && opts.visible(n))
        .map((n) => ({ x: n.x, y: n.y, r: nodeRadius(n), rooms: opts.roomsByNode.get(n.id) ?? [] })),
      opts.rooms,
      opts.tallies,
      (id) => slack.get(id) ?? 1,
    );

  /** Only "role" has a fallback room, so a card on a derived preset (Colour, Subtype, Type,
   *  Mana value) whose rooms all miss it is genuinely unzoned -- CENTER_PULL is what holds it
   *  near the board instead of it drifting. Non-card nodes are centred for the same reason. */
  const zoned = (n: Sim) =>
    n.kind === "card" && (opts.roomsByNode.get(n.id)?.length ?? 0) > 0;

  const simulation = forceSimulation<Sim>(opts.nodes)
    .force("charge", forceManyBody<Sim>()
      .strength(-p.repulsion)
      // Ports the old `max(d2, 64)` floor and `d2 > 220000` cutoff. d3 squares these
      // internally; distanceMin is a geometric mean rather than a hard clamp.
      .distanceMin(8)
      .distanceMax(p.repulsionRange))
    .force("link", forceLink<Sim, { source: Sim; target: Sim }>(opts.links)
      .id((n) => n.id)
      // A spring between two 14px discs and one between two 3px dots should not want the same
      // length, so rest scales with what it joins.
      .distance((l) => nodeRadius(l.source) + nodeRadius(l.target) + EDGE_GAP)
      // Explicit strength overrides d3's degree-normalized default.
      .strength(p.linkStiffness))
    // Replaces separation(). COLLISION_PAD is the gap between two settled discs, so each disc
    // carries half of it. See the design doc's 3.2 -- this is velocity-based where separation()
    // was positional, which is why the overlap assertion is the one at risk.
    .force("collide", forceCollide<Sim>()
      .radius((n) => nodeRadius(n) + COLLISION_PAD / 2)
      .iterations(p.collideIterations))
    .force("x", forceX<Sim>(0).strength((n) => (zoned(n) ? 0 : p.centerPull)))
    .force("y", forceY<Sim>(0).strength((n) => (zoned(n) ? 0 : p.centerPull)))
    .force("rooms", forceRoomAttraction({
      roomsByNode: opts.roomsByNode,
      stiffness: p.roomAttraction,
    }))
    .force("containment", forceRoomContainment({
      roomsByNode: opts.roomsByNode,
      circles: roomCircles,
      containmentStiffness: p.containment,
      foreignStiffness: p.foreignPush,
      foreignMargin: p.foreignMargin,
    }))
    .force("breathing", forceRoomBreathing({
      roomsByNode: opts.roomsByNode,
      slack,
      grow: p.breatheGrow,
      decay: BREATHE_DECAY,
      max: BREATHE_MAX,
      alpha: BREATHE_ALPHA,
    }))
    .force("nested", forceNestedOffset({
      roomsByNode: opts.roomsByNode,
      circles: roomCircles,
      stiffness: p.nestedOffset,
    }))
    .velocityDecay(p.velocityDecay)
    .alphaDecay(p.alphaDecay)
    .alphaTarget(p.alphaFloor)
    .stop();

  return { simulation, roomCircles };
}
