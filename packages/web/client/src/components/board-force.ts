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

/** Above this share of the visible card nodes, a room stops contributing to roomAttraction. */
export const UNIVERSAL_ROOM_FRACTION = 0.8;

/** Rooms holding so much of the deck that pairwise attraction through them says nothing.
 *  ROOM_ATTRACTION applies per shared room per card pair, so a room holding the whole deck makes
 *  all 4,851 pairs attract with only separation() pushing back -- the pile-up a mono-black deck
 *  grouped by Colour shows.
 *
 *  Strictly "exceeds", not "reaches": a room on exactly the fraction still attracts.
 *
 *  Exemption is from the FORCE only. The room still draws, still gets a legend row, still paints
 *  rim arcs, and still takes part in containment and foreignPush.
 *
 *  This mirrors a ruling already made once: Strategy claimed 94 of 94 cards via archetypes and was
 *  cut back for the same reason -- "a set containing everything, which distinguishes nothing"
 *  (deck-rooms.ts's roomsForCard). */
export function universalRooms(
  roomIds: readonly string[],
  memberships: readonly (readonly string[])[],
  fraction: number = UNIVERSAL_ROOM_FRACTION,
): Set<string> {
  const out = new Set<string>();
  if (memberships.length === 0) return out;
  const held = new Map<string, number>();
  for (const rooms of memberships) for (const id of rooms) held.set(id, (held.get(id) ?? 0) + 1);
  for (const id of roomIds) {
    if ((held.get(id) ?? 0) > memberships.length * fraction) out.add(id);
  }
  return out;
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
): { x: number; y: number } {
  const d = Math.hypot(dx, dy);
  if (d === 0) return { x: 0, y: 0 };
  const depth = roomR - (d - cardR);
  if (depth <= 0) return { x: 0, y: 0 };
  const f = depth * stiffness;
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

/** A d3-force custom force: a function of the current alpha, plus the `initialize` hook
 *  `simulation.force(name, f)` calls to hand it the node array. */
export type CustomForce = ((alpha: number) => void) & { initialize(nodes: Sim[]): void };

/** Cards sharing a room pull together; the room's circle is then drawn around the cluster they
 *  form. The only force that reads membership pairwise.
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
  universal: ReadonlySet<string>;
  stiffness: number;
}): CustomForce {
  let cards: Sim[] = [];
  const force = ((alpha: number) => {
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i], b = cards[j];
        const ra = opts.roomsByNode.get(a.id), rb = opts.roomsByNode.get(b.id);
        if (!ra || !rb) continue;
        let shared = 0;
        for (const id of ra) if (!opts.universal.has(id) && rb.includes(id)) shared++;
        if (shared === 0) continue;
        // alpha scales the force, not the integration step -- that is d3's convention and the
        // one difference from the loop this replaces (design doc 3).
        const t = roomAttraction(a.x - b.x, a.y - b.y, shared, opts.stiffness * alpha);
        a.vx += t.x; a.vy += t.y;
        b.vx -= t.x; b.vy -= t.y;
      }
    }
  }) as CustomForce;
  force.initialize = (nodes: Sim[]) => { cards = nodes.filter((n) => n.kind === "card"); };
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
          : foreignPush(dx, dy, c.r, cardR, opts.foreignStiffness * alpha);
        n.vx += t.x; n.vy += t.y;
      }
    }
  }) as CustomForce;
  force.initialize = (nodes: Sim[]) => { cards = nodes.filter((n) => n.kind === "card"); };
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
  roomAttraction: number;
  containment: number;
  foreignPush: number;
  linkStiffness: number;
  centerPull: number;
  velocityDecay: number;
  alphaDecay: number;
  alphaFloor: number;
  collideIterations: number;
}

export const DEFAULT_PARAMS: BoardParams = {
  repulsion: REPULSION,
  roomAttraction: ROOM_ATTRACTION,
  containment: CONTAINMENT,
  foreignPush: FOREIGN_PUSH,
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
  universal: ReadonlySet<string>;
  visible: (n: Sim) => boolean;
  params?: Partial<BoardParams>;
}): { simulation: Simulation<Sim, undefined>; roomCircles: () => Map<RoomId, Circle> } {
  const p = { ...DEFAULT_PARAMS, ...opts.params };
  const roomCircles = () =>
    roomLayout(
      opts.nodes
        .filter((n) => n.kind === "card" && opts.visible(n))
        .map((n) => ({ x: n.x, y: n.y, r: nodeRadius(n), rooms: opts.roomsByNode.get(n.id) ?? [] })),
      opts.rooms,
      opts.tallies,
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
      .distanceMax(469))
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
      universal: opts.universal,
      stiffness: p.roomAttraction,
    }))
    .force("containment", forceRoomContainment({
      roomsByNode: opts.roomsByNode,
      circles: roomCircles,
      containmentStiffness: p.containment,
      foreignStiffness: p.foreignPush,
    }))
    .velocityDecay(p.velocityDecay)
    .alphaDecay(p.alphaDecay)
    .alphaTarget(p.alphaFloor)
    .stop();

  return { simulation, roomCircles };
}
