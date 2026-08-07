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
 *  board tighter, so escapes fall and intrusions rise. 25 is the midpoint of the measured failing
 *  bracket (40 above, 10 below) rather than the first passing value found, so it carries margin on
 *  both sides. Overlaps were 0/10 at EVERY value tried, including 2200. */
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
 *  So REPULSION 25 is measured with all 346 nodes live. If Task 5 filters, the constants must be
 *  re-tuned against the filtered board, not merely re-checked.
 *  See `2026-08-08-d3-migration-measurements.md`. */
export function createBoardSimulation(opts: {
  nodes: Sim[];
  links: { source: Sim; target: Sim }[];
  roomsByNode: ReadonlyMap<string, readonly RoomId[]>;
  rooms: readonly { id: RoomId }[];
  tallies: Map<RoomId, RoomTally>;
  universal: ReadonlySet<string>;
  visible: (n: Sim) => boolean;
}): { simulation: Simulation<Sim, undefined>; roomCircles: () => Map<RoomId, Circle> } {
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
      .strength(-REPULSION)
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
      .strength(LINK_STIFFNESS))
    // Replaces separation(). COLLISION_PAD is the gap between two settled discs, so each disc
    // carries half of it. See the design doc's 3.2 -- this is velocity-based where separation()
    // was positional, which is why the overlap assertion is the one at risk.
    .force("collide", forceCollide<Sim>()
      .radius((n) => nodeRadius(n) + COLLISION_PAD / 2)
      .iterations(COLLIDE_ITERATIONS))
    .force("x", forceX<Sim>(0).strength((n) => (zoned(n) ? 0 : CENTER_PULL)))
    .force("y", forceY<Sim>(0).strength((n) => (zoned(n) ? 0 : CENTER_PULL)))
    .force("rooms", forceRoomAttraction({
      roomsByNode: opts.roomsByNode,
      universal: opts.universal,
      stiffness: ROOM_ATTRACTION,
    }))
    .force("containment", forceRoomContainment({
      roomsByNode: opts.roomsByNode,
      circles: roomCircles,
      containmentStiffness: CONTAINMENT,
      foreignStiffness: FOREIGN_PUSH,
    }))
    .velocityDecay(VELOCITY_DECAY)
    .alphaDecay(ALPHA_DECAY)
    .alphaTarget(ALPHA_FLOOR)
    .stop();

  return { simulation, roomCircles };
}
