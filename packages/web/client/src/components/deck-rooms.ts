/** The seven rooms of the deck board. Fixed for every deck: an empty room is the finding
 *  ("BOARD WIPES 0/3"), so rooms are drawn whether or not any card lands in them. */
export type RoomId =
  | "strategy" | "wincons" | "cardAdvantage" | "ramp" | "lands" | "interaction" | "boardWipes";

export interface Room {
  id: RoomId;
  label: string;
  /** BuildCategory values that land a card in this room. Strategy has none -- it is the
   *  fallback, and takes every card no other room claims. */
  categories: string[];
}

/** Order is the declaration order used everywhere a room list is iterated, so a card's rooms
 *  come out in a stable order regardless of the order its roles arrived in. */
export const ROOMS: Room[] = [
  { id: "strategy", label: "Strategy", categories: [] },
  { id: "wincons", label: "Win conditions", categories: ["burn", "tutor"] },
  { id: "cardAdvantage", label: "Card advantage", categories: ["draw", "cardSelection"] },
  { id: "ramp", label: "Ramp", categories: ["ramp"] },
  { id: "lands", label: "Lands", categories: ["lands"] },
  { id: "interaction", label: "Interaction", categories: ["targetedRemoval", "stackInteraction", "protection", "stax"] },
  { id: "boardWipes", label: "Board wipes", categories: ["boardWipe"] },
];

/** Validated dark-surface categorical hues (see the plan's Global Constraints for the check
 *  that produced them). Used on a room's outline and label, never as the identifying fill:
 *  a translucent fill over this surface collapses toward gray and stops separating.
 *
 *  Assignment is NOT arbitrary: it is the one permutation of these 7 hues, found by
 *  brute-force search over all 5040 room<->hue assignments, whose worst CVD deltaE among the
 *  10 grid-adjacency (touching-on-screen) room pairs still clears the "pass" target (>= 8.0,
 *  not just the 6.0 floor). The naive assignment (hues in ROOMS declaration order) put
 *  strategy next to cardAdvantage at deltaE 1.9 and wincons next to boardWipes at 2.7 --
 *  both far below the floor -- because grid adjacency and declaration order are unrelated.
 *  Do not reassign without rerunning that search; see task-3-report.md for the touching-pair
 *  list and validator output. */
export const ROOM_HUE: Record<RoomId, string> = {
  strategy: "#9085e9",
  wincons: "#d95926",
  cardAdvantage: "#d55181",
  ramp: "#008300",
  lands: "#3987e5",
  interaction: "#c98500",
  boardWipes: "#199e70",
};

const ROOM_OF_CATEGORY = new Map<string, RoomId>(
  ROOMS.flatMap((r) => r.categories.map((c) => [c, r.id] as const)),
);

/** Plain-language names for the categories whose engine key is jargon. "Card selection" means
 *  scry/surveil/look-at-the-top-N/impulse-draw -- digging without drawing -- and "stack
 *  interaction" is one letter from "stax" while meaning something unrelated. Shown on hover.
 *  "Stax", "tutor", and "ramp" are Magic slang, not English words, so they get entries too:
 *  stax (STAX_RE in build.ts) matches "can't untap"/"spells cost more"/"players can't" -- tax
 *  and lock effects; tutor (TUTOR_RE) matches "search your library for" -- finding a specific
 *  card from the deck; ramp covers mana-generation/fast-mana/ritual effect kinds plus land-fetch
 *  and treasure/gold tokens -- getting more mana than a land drop gives. "Protection", "draw",
 *  and "lands" are left untranslated: they are already plain English words that describe
 *  themselves correctly to a non-Magic player. */
const PLAIN: Record<string, string> = {
  cardSelection: "digging",
  stackInteraction: "counterspells",
  targetedRemoval: "removal",
  boardWipe: "board wipe",
  burn: "burn & drain",
  stax: "taxes & locks",
  tutor: "deck search",
  ramp: "extra mana",
};

export function subcategoryLabel(category: string): string {
  return PLAIN[category] ?? category;
}

/** Every room a card belongs to, in ROOMS order. `comboCards` is a name set built from
 *  report.combos[].cards.
 *
 *  Strategy is the fallback and ONLY the fallback: a card it holds is in no other room. It used to
 *  also be added for any card named by report.archetypes[].cards, matching the original design
 *  doc's "archetype groups, plus every card no other room claims" -- but the engine's archetypes
 *  are near-universal (94 of 94 cards on the reference deck), so that made Strategy a set
 *  containing everything, which distinguishes nothing and dragged every card toward a second
 *  anchor. See 2026-08-04-circle-rooms-design.md.
 *
 *  This exclusivity is load-bearing downstream: it is why a card's rim can never need more than six
 *  arcs. */
export function roomsForCard(
  roles: string[] | undefined,
  name: string,
  comboCards: Set<string>,
): RoomId[] {
  const hit = new Set<RoomId>();
  for (const role of roles ?? []) {
    const room = ROOM_OF_CATEGORY.get(role);
    if (room) hit.add(room);
  }
  if (comboCards.has(name)) hit.add("wincons");
  if (hit.size === 0) hit.add("strategy");
  return ROOMS.filter((r) => hit.has(r.id)).map((r) => r.id);
}

export interface RoomTally {
  count: number;
  target: number;
  /** True only when the room has a target at all and holds fewer cards than it. A room with no
   *  target (strategy, win conditions) is never under -- it has nothing to be under. */
  under: boolean;
}

/** `cardRooms` maps a card's name to the rooms it landed in (from roomsForCard). `buildCategories`
 *  is report.buildCategories as sent -- already archetype-adjusted -- or undefined on a report
 *  that has none, in which case every room reports a bare count.
 *
 *  A room's count is the number of COPIES in it, not distinct names: the engine's own build
 *  targets (computeBuild) count land copies, so a 36-target Lands room has to count the same way
 *  or it reads `14/36` on a deck with 24 basics that's actually fine. `copiesByName` supplies that
 *  -- absent (or missing an entry) means one copy, since a card not driven by a multi-name-legal
 *  deck (Relentless Rats, basics, etc.) really does have exactly one.
 *
 *  A room's target, meanwhile, is the SUM of its subcategories' targets. These come from different
 *  levels on purpose: a card in both draw and cardSelection counts once (or once per copy) toward
 *  cardAdvantage's count, but contributes both categories' targets to cardAdvantage's target. That
 *  asymmetry is intentional per the task spec, not a bug -- implemented as specified even though it
 *  means the target isn't strictly "how many copies you need" in the same units as count. */
export function roomTallies(
  cardRooms: Map<string, readonly RoomId[]>,
  buildCategories: { category: string; count: number; target: number }[] | undefined,
  copiesByName?: Map<string, number>,
): Map<RoomId, RoomTally> {
  const targetOf = new Map((buildCategories ?? []).map((c) => [c.category, c.target]));
  const counts = new Map<RoomId, number>();
  for (const [name, rooms] of cardRooms) {
    const copies = copiesByName?.get(name) ?? 1;
    for (const id of rooms) counts.set(id, (counts.get(id) ?? 0) + copies);
  }
  const out = new Map<RoomId, RoomTally>();
  for (const room of ROOMS) {
    const target = room.categories.reduce((sum, c) => sum + (targetOf.get(c) ?? 0), 0);
    const count = counts.get(room.id) ?? 0;
    out.set(room.id, { count, target, under: target > 0 && count < target });
  }
  return out;
}

/** The card disc's rim, split into one equal arc per room the card is in, each in that room's hue.
 *  Angles are radians from 12 o'clock, clockwise, covering the full circle.
 *
 *  This is the AUTHORITATIVE membership signal, and the lens a card sits in is the bonus. Position
 *  cannot be complete: circles cannot realise an arbitrary Euler diagram past three sets, and a
 *  tightly packed cluster can hide a lens entirely. The rim reads either way.
 *
 *  Six arcs is the hard maximum, not a truncation: Strategy is the fallback, so a card in Strategy
 *  is in no other room, leaving the six type-and-role rooms as the ceiling. Six is also where
 *  legibility runs out (60 degrees is ~10px of stroke at a 14px disc), and the two coinciding is
 *  luck -- if Strategy ever stops being exclusive, the rim breaks before the geometry does. */
export function rimArcs(rooms: readonly RoomId[]): Array<{ hue: string; from: number; to: number }> {
  if (rooms.length === 0) return [];
  const step = (Math.PI * 2) / rooms.length;
  const start = -Math.PI / 2;
  return rooms.map((id, i) => ({
    hue: ROOM_HUE[id],
    from: start + i * step,
    to: start + (i + 1) * step,
  }));
}

export interface Circle { x: number; y: number; r: number }

/** A card as the layout sees it: where it is, how big it draws, and which rooms it is in. */
export interface RoomMember { x: number; y: number; r: number; rooms: readonly RoomId[] }

/** Radius an empty room draws at, in world units. Empty rooms have no members to measure, and the
 *  alternative is a zero-radius circle -- but an empty room being VISIBLE is the entire point
 *  ("BOARD WIPES 0/3" is the finding). Scaled by target so a 3-wipe hole reads bigger than a
 *  1-wipe one; the additive base keeps a room with no target at all from vanishing. */
const EMPTY_BASE_R = 26;
const EMPTY_R_PER_TARGET = 6;
/** How far outside the occupied cluster empty rooms are parked, as a multiple of the cluster's own
 *  radius. Above 1 so an empty room never sits on top of an occupied one. */
const EMPTY_ORBIT = 1.45;

/** Each room is the circle enclosing its member cards: centre at their centroid, radius out to the
 *  furthest member's FAR rim (not its centre, or the member would hang half outside).
 *
 *  This is the inversion the board rests on. A card in two rooms is inside both circles because
 *  both circles are DEFINED to enclose it -- so "cards outside every room they belong to" is zero
 *  by construction, not by tuning, and it stays zero for a card in three or six rooms with no extra
 *  case. See 2026-08-04-circle-rooms-design.md.
 *
 *  Centroid-and-max-distance, deliberately NOT the minimal enclosing circle: this is O(n),
 *  deterministic, and trivially testable, and the tighter version is not worth Welzl's algorithm.
 *
 *  There is no target floor on an occupied room. Size means "how much is in here", which is true
 *  without reconciling units -- a target counts COPIES while a radius packs NODES, and flooring
 *  Lands at its 36 target draws slack on a deck running 37 lands. The label states underfill
 *  exactly; the circle does not try to. */
export function roomLayout(
  members: readonly RoomMember[],
  tallies: Map<RoomId, RoomTally>,
): Map<RoomId, Circle> {
  const byRoom = new Map<RoomId, RoomMember[]>();
  for (const m of members) {
    for (const id of m.rooms) {
      const list = byRoom.get(id);
      if (list) list.push(m);
      else byRoom.set(id, [m]);
    }
  }

  const out = new Map<RoomId, Circle>();
  for (const room of ROOMS) {
    const held = byRoom.get(room.id);
    if (!held || held.length === 0) continue;
    let sx = 0, sy = 0;
    for (const m of held) { sx += m.x; sy += m.y; }
    const x = sx / held.length, y = sy / held.length;
    let r = 0;
    for (const m of held) r = Math.max(r, Math.hypot(m.x - x, m.y - y) + m.r);
    out.set(room.id, { x, y, r });
  }

  // Empty rooms have no centroid. Park them in a ring outside everything occupied, in ROOMS order,
  // so they are visible and cannot overlap a room that holds cards.
  const empties = ROOMS.filter((room) => !out.has(room.id));
  if (empties.length > 0) {
    let cx = 0, cy = 0, spread = 0;
    const occupied = [...out.values()];
    for (const c of occupied) { cx += c.x; cy += c.y; }
    if (occupied.length > 0) {
      cx /= occupied.length; cy /= occupied.length;
      for (const c of occupied) spread = Math.max(spread, Math.hypot(c.x - cx, c.y - cy) + c.r);
    }
    empties.forEach((room, i) => {
      const target = tallies.get(room.id)?.target ?? 0;
      const r = EMPTY_BASE_R + target * EMPTY_R_PER_TARGET;
      const angle = (i / empties.length) * Math.PI * 2;
      const orbit = spread * EMPTY_ORBIT + r;
      out.set(room.id, { x: cx + Math.cos(angle) * orbit, y: cy + Math.sin(angle) * orbit, r });
    });
  }
  return out;
}
