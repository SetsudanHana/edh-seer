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
 *  a translucent fill over this surface collapses toward gray and stops separating. */
export const ROOM_HUE: Record<RoomId, string> = {
  strategy: "#9085e9",
  wincons: "#d95926",
  cardAdvantage: "#3987e5",
  ramp: "#199e70",
  lands: "#c98500",
  interaction: "#d55181",
  boardWipes: "#008300",
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

/** Every room a card belongs to, in ROOMS order. `comboCards` and `strategyCards` are name sets
 *  built from report.combos[].cards and report.archetypes[].cards respectively. A card nothing
 *  else claims falls back to strategy -- the creatures and payoffs that are neither ramp nor
 *  answers ARE the strategy, which is what makes strategy the board's largest room. */
export function roomsForCard(
  roles: string[] | undefined,
  name: string,
  comboCards: Set<string>,
  strategyCards: Set<string>,
): RoomId[] {
  const hit = new Set<RoomId>();
  for (const role of roles ?? []) {
    const room = ROOM_OF_CATEGORY.get(role);
    if (room) hit.add(room);
  }
  if (comboCards.has(name)) hit.add("wincons");
  if (strategyCards.has(name)) hit.add("strategy");
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
