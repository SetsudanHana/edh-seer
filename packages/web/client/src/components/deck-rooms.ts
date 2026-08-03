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

export interface Rect { x: number; y: number; w: number; h: number }

/** Fixed 3-column grid, one entry per row. Strategy and Lands span two columns -- strategy
 *  because it is the fallback and holds the most cards, lands because 36 cards need the floor.
 *  Row order puts likely multi-room pairs adjacent (card advantage beside interaction, ramp
 *  under card advantage) so a card in two rooms straddles a shared border. Row order is
 *  load-bearing, not decorative -- do not reorder for aesthetics; see the task brief. */
const GRID: { id: RoomId; span: number }[][] = [
  [{ id: "strategy", span: 2 }, { id: "wincons", span: 1 }],
  [{ id: "cardAdvantage", span: 1 }, { id: "interaction", span: 1 }, { id: "boardWipes", span: 1 }],
  [{ id: "ramp", span: 1 }, { id: "lands", span: 2 }],
];

const COLUMNS = 3;
/** Fraction of the viewport the board occupies. Under 1 so the outermost room outlines are not
 *  flush with the canvas edge, where a label would be clipped. */
const BOARD_FILL = 0.92;

export function roomLayout(width: number, height: number): Map<RoomId, Rect> {
  // A canvas legitimately reports 0 (or, transiently through a subtraction, a negative number)
  // during layout -- clamp here, once, so every caller (the sim's anchors, the resize handler,
  // Task 5's chrome) gets a degenerate-but-sane zero-size board instead of a mirrored one where
  // width or height inverted every rect's x/y.
  const boardW = Math.max(0, width) * BOARD_FILL;
  const boardH = Math.max(0, height) * BOARD_FILL;
  const colW = boardW / COLUMNS;
  const rowH = boardH / GRID.length;
  const out = new Map<RoomId, Rect>();
  GRID.forEach((row, rowIndex) => {
    let col = 0;
    for (const cell of row) {
      out.set(cell.id, {
        x: -boardW / 2 + col * colW,
        y: -boardH / 2 + rowIndex * rowH,
        w: colW * cell.span,
        h: rowH,
      });
      col += cell.span;
    }
  });
  return out;
}

export function roomCenter(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}
