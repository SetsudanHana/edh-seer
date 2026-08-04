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

/** Dark-surface categorical hues, used on a room's outline and rim arc, never as the identifying
 *  fill: a translucent fill over this surface collapses toward gray and stops separating (see the
 *  plan's Global Constraints).
 *
 *  These are graphic objects (a 1.5px outline stroke, a 2.5px rim arc), so the search below
 *  targeted WCAG's graphic-object floor, contrast >=3:1 against the surface -- NOT the >=4.5:1
 *  floor body text needs. The room LABEL is text and does need 4.5:1; three of these seven hues
 *  (cardAdvantage, interaction, ramp) clear 3:1 but land at 3.00-3.18, short of 4.5:1. The label
 *  paints from ROOM_HUE_TEXT instead (below), not this map -- see its doc comment for why raising
 *  these three hues' lightness in place was tried and rejected.
 *
 *  Validated against rim and lens adjacency, the two relations that replaced grid adjacency
 *  when rooms became circles derived from member cards (Tasks 1-7 of 2026-08-04-circle-rooms).
 *  Both reduce to the same thing: two rooms that share a member card. rimArcs places a 2-room
 *  card's two arcs adjacent by construction (only one pair exists to place), and roomLayout
 *  draws each room's circle around exactly its members, so two rooms sharing a card have
 *  circles that structurally overlap at that card's position. Strategy never enters either
 *  relation: it is the exclusive fallback (roomsForCard), so a card in strategy is in no other
 *  room and never shares a card with one.
 *
 *  Because ROOMS' categories are independent per-card flags (build.ts runs each category's
 *  regex against the same oracle text, not mutually exclusive), any two of the six non-strategy
 *  rooms can end up as a card's only two roles in some deck, even where the reference deck
 *  (packages/cli/decks/inalla.txt) doesn't produce that pair itself -- so the validated set is
 *  all 15 pairs among {wincons, cardAdvantage, ramp, lands, interaction, boardWipes} (K6), not
 *  just the 4 pairs inalla.txt measures.
 *
 *  History (see task-8-report.md, 2026-08-04): the assignment inherited from the grid-adjacency
 *  era failed this 15-pair set outright (worst pair deltaE 1.6), and a brute-force search over
 *  its same 7 hues found NO reassignment clearing the floor (best possible: 1.9) -- permuting a
 *  fixed hue pool can't help against an all-pairs requirement, since every permutation scores
 *  the same 15 pairwise distances; only which single hue lands on Strategy (excluded from every
 *  pair) changes. That escalated to a human ruling: unfreeze the pool and search NEW hues,
 *  varying lightness as well as hue -- protan/deutan collapse red-green separation, so lightness
 *  is the axis that still carries information for a dichromat, and the grid-tuned pool barely
 *  used it. This is the result: a farthest-point + local-search over an OKLCH grid (dark band
 *  L 0.48-0.67, chroma pushed near the in-gamut max, every candidate individually clearing
 *  chroma floor and >=3:1 contrast against the real #14171b surface), scored by worst CVD
 *  deltaE across all 15 K6 pairs subject to the validator's hard 15.0 normal-vision floor on
 *  every one of those pairs too (not CVD alone -- a first pass optimizing CVD only found a set
 *  that missed the normal-vision floor by <1.0 on 3 pairs).
 *
 *  Validator output (validate_palette.js, --mode dark --surface "#14171b", 3 runs whose
 *  consecutive pairs union to the 15 K6 edges -- --pairs adjacent only checks consecutive
 *  entries, so one 7-hue list can't cover them):
 *    Run 1 (wincons,cardAdvantage,ramp,lands,interaction,boardWipes): ALL CHECKS PASS,
 *      worst adjacent #146d9e<->#5b40f6 deltaE 13.9 (deutan)
 *    Run 2 (cardAdvantage,lands,boardWipes,wincons,ramp,interaction): ALL CHECKS PASS,
 *      worst adjacent #6b89f9<->#21a28f deltaE 17.0 (deutan)
 *    Run 3 (ramp,boardWipes,cardAdvantage,interaction,wincons,lands): ALL CHECKS PASS,
 *      worst adjacent #5b40f6<->#6b89f9 deltaE 12.4 (deutan)
 *  Worst pair over the full 15-edge set: cardAdvantage<->boardWipes at 12.4 (Run 3) -- clears the
 *  8.0 target on every pair, clears the hard 15.0 normal-vision floor on every pair (worst 16.2), and
 *  strategy's `#1c8db7` independently clears lightness/chroma/contrast (it carries no pairwise
 *  requirement -- excluded from every K6 pair by its own exclusivity). Room<->hue pairing below
 *  is exactly what was validated above -- relabeling which room gets which of these same six
 *  hex values would still score the same 15 pairwise distances (the check is per-hue-pair, not
 *  per-room-name), but would invalidate the verbatim Run 1-3 room-name lists above, so don't
 *  without re-running and re-quoting. Do not reassign without rerunning the search; the search
 *  script lived in scratch, not the repo -- see task-8-report.md for the full method if this
 *  needs redoing. */
export const ROOM_HUE: Record<RoomId, string> = {
  strategy: "#1c8db7",
  wincons: "#b08e1d",
  cardAdvantage: "#5b40f6",
  ramp: "#146d9e",
  lands: "#21a28f",
  interaction: "#277310",
  boardWipes: "#6b89f9",
};

/** Text-safe variant of ROOM_HUE, used ONLY for the room label (GraphView.tsx's `roomFontPx`
 *  fillText) -- never for the outline stroke, the fill wash, or a card's rim arcs, all of which
 *  stay on ROOM_HUE. The two draw contexts have different floors and ROOM_HUE was validated
 *  against the wrong one for text: the outline (1.5px stroke) and rim (2.5px arc) are graphic
 *  objects, WCAG's >=3:1 floor, which is what ROOM_HUE's search targeted. The label is body text
 *  at 12/cam.z px, normal weight, which needs WCAG's >=4.5:1 -- three of ROOM_HUE's seven hues
 *  (cardAdvantage 3.00, interaction 3.04, ramp 3.18 against surface #14171b) clear the graphic
 *  floor but fail the text one.
 *
 *  Fallback route, not the preferred one: raising those three hues' OKLCH lightness to clear
 *  4.5:1 (keeping hue and chroma fixed) was tried first and REJECTED -- it breaks the CVD
 *  separation ROOM_HUE's doc comment records. Re-validated with the same three orderings used to
 *  originally clear the palette:
 *    lightened set (cardAdvantage #786bff, ramp #3687b9, interaction #469134, others unchanged):
 *    Run 1 (wincons,cardAdvantage,ramp,lands,interaction,boardWipes): FAIL -- normal-vision floor,
 *      interaction<->lands (then #469134<->#21a28f) deltaE 11.0, below the hard 15.0 floor
 *    Run 3 (ramp,boardWipes,cardAdvantage,interaction,wincons,lands): FAIL -- CVD separation,
 *      wincons<->interaction (#b08e1d<->#469134) deltaE 3.4 protan, below the 6.0 floor; also
 *      normal-vision floor, cardAdvantage<->boardWipes deltaE 7.2
 *  The pool was already near its ceiling (worst validated pair 12.4, see ROOM_HUE's comment) --
 *  bumping three lightnesses at once shoves them into other pairs' territory. Lightness alone
 *  cannot buy 4.5:1 on those three without a full hue+lightness re-search, which is out of scope
 *  for a text-contrast fix. ROOM_HUE_TEXT instead lightens the SAME three hues (same H, same C,
 *  higher L) but keeps them out of the rim/lens/outline system entirely, so the CVD-validated
 *  ROOM_HUE set is untouched. All seven values individually clear >=4.5:1 against #14171b; pairwise
 *  CVD separation between label colors is not required here the way it is for ROOM_HUE, because a
 *  label's room name is printed in the text itself -- hue only has to trace a displaced label back
 *  to its own circle's (ROOM_HUE) outline, a same-hue-family match, not distinguish one label's hue
 *  from a different room's label the way two overlapping rim arcs must. */
export const ROOM_HUE_TEXT: Record<RoomId, string> = {
  ...ROOM_HUE,
  cardAdvantage: "#786bff",
  ramp: "#3687b9",
  interaction: "#469134",
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
