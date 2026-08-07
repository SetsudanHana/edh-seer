import { ART_RADIUS } from "./deck-rooms.js";
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
