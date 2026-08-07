/** Was a seven-value union. A room is now anything a preset declares -- a type, a colour, a
 *  subtype -- so the id is an opaque string and the ROOMS constant below is just the role preset's
 *  room list. */
export type RoomId = string;

export interface Room {
  id: RoomId;
  label: string;
  /** BuildCategory values that land a card in this room. Strategy has none -- it is the
   *  fallback, and takes every card no other room claims. */
  categories: string[];
}

/** The seven rooms of the default role preset. Fixed for every deck: an empty room is the finding
 *  ("BOARD WIPES 0/3"), so rooms are drawn whether or not any card lands in them.
 *
 *  Order is the declaration order used everywhere a room list is iterated, so a card's rooms
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
 *  floor body text needs. A room's name used to be painted as a canvas label held to that higher
 *  floor; it now lives in the DOM legend instead, where it is ordinary page foreground text and
 *  carries no hue of its own at all (see 2026-08-07-room-size-and-board-chrome's Task 8).
 *
 *  Validated against rim and lens adjacency, the two relations that replaced grid adjacency
 *  when rooms became circles derived from member cards (Tasks 1-7 of 2026-08-04-circle-rooms).
 *  Both reduce to the same thing: two rooms that share a member card. rimArcs places a 2-room
 *  card's two arcs adjacent by construction (only one pair exists to place),
 *  and two rooms sharing a card have circles that overlap in practice (empirically, not
 *  structurally -- roomLayout sizes a circle by member COUNT now, so overlap is a consequence of
 *  where the layout puts things rather than a guarantee of how the circle is built). The
 *  all-pairs (K6) requirement the search actually solved was never specific to WHICH pairs
 *  overlap, so the validated palette below stands unchanged. Strategy never enters either
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

/** The sixth arc when a card is in more than six rooms. Six is rimArcs' legibility floor (60 deg is
 *  ~10px of stroke at a 14px disc) and predicates removed the guarantee that nothing exceeds it: a
 *  WUBRG card is in five colour rooms before any other preset is considered. Neutral on purpose --
 *  it means "and more", not a room. */
export const OVERFLOW_HUE = "#6b7280";

/** `ROOM_HUE[id]`, but safe now that `RoomId` is `string`: the compiler can no longer prove every
 *  id is a key, and an id from a preset ROOM_HUE has never heard of (a colour, a type, a subtype)
 *  would otherwise paint `strokeStyle = undefined` -- silently, with nothing to catch it. Falls
 *  back to OVERFLOW_HUE, which already means "and more" rather than a specific room. */
export function roomHueOf(id: RoomId): string {
  return ROOM_HUE[id] ?? OVERFLOW_HUE;
}

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
 *  This exclusivity is why a card in THIS room list can never need more than six arcs -- true of
 *  ROOMS specifically, not of every room list rimArcs might be given. Other presets (colours,
 *  types) have no such exclusive fallback, so rimArcs enforces its own six-arc cap explicitly
 *  rather than relying on a guarantee only this function's caller happens to provide. */
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
  rooms: readonly { id: RoomId; categories: string[] }[],
  buildCategories: { category: string; count: number; target: number }[] | undefined,
  copiesByName?: Map<string, number>,
): Map<RoomId, RoomTally> {
  const targetOf = new Map((buildCategories ?? []).map((c) => [c.category, c.target]));
  const counts = new Map<RoomId, number>();
  for (const [name, cardsRooms] of cardRooms) {
    const copies = copiesByName?.get(name) ?? 1;
    for (const id of cardsRooms) counts.set(id, (counts.get(id) ?? 0) + copies);
  }
  const out = new Map<RoomId, RoomTally>();
  for (const room of rooms) {
    const target = room.categories.reduce((sum, c) => sum + (targetOf.get(c) ?? 0), 0);
    const count = counts.get(room.id) ?? 0;
    out.set(room.id, { count, target, under: target > 0 && count < target });
  }
  return out;
}

/** Which hues a card's rim actually shows, capped at six. Six is where legibility runs out (60
 *  degrees is ~10px of stroke at a 14px disc) and predicates removed the guarantee that nothing
 *  exceeds it: a WUBRG card is in five colour rooms before any other preset is considered. Past
 *  five explicit hues the sixth is painted in OVERFLOW_HUE ("and more") rather than dropping hues
 *  silently or squeezing seven in.
 *
 *  Its own function, not a line inside rimArcs, because two painters consume the rule now: rimArcs
 *  converts these to angles for miniature mode, and GraphView.tsx's card mode converts them to
 *  equal-width bars along the card's bottom edge. One cap, one place. */
export function rimHues(hues: readonly string[]): string[] {
  return hues.length > 6 ? [...hues.slice(0, 5), OVERFLOW_HUE] : [...hues];
}

/** The card disc's rim, split into one equal arc per hue given -- one per room the card is in.
 *  Takes hues, not room objects: this is pure geometry with no business knowing what a room is,
 *  and it is the caller's job to resolve a card's rooms to their hues (ROOM_HUE[id]) first.
 *  Angles are radians from 12 o'clock, clockwise, covering the full circle.
 *
 *  This is the AUTHORITATIVE membership signal, and the lens a card sits in is the bonus. Position
 *  cannot be complete: circles cannot realise an arbitrary Euler diagram past three sets, and a
 *  tightly packed cluster can hide a lens entirely. The rim reads either way. */
export function rimArcs(hues: readonly string[]): Array<{ hue: string; from: number; to: number }> {
  const shown = rimHues(hues);
  if (shown.length === 0) return [];
  const step = (Math.PI * 2) / shown.length;
  const start = -Math.PI / 2;
  return shown.map((hue, i) => ({
    hue,
    from: start + i * step,
    to: start + (i + 1) * step,
  }));
}

export interface Circle { x: number; y: number; r: number }

/** A card as the layout sees it: where it is, how big it draws, and which rooms it is in. */
export interface RoomMember { x: number; y: number; r: number; rooms: readonly RoomId[] }

/** Radius (world units) a card node draws at. Lives HERE, not in GraphView.tsx, because
 *  roomRadius below sizes a room from its members' own footprints and deck-rooms.ts must not
 *  import from GraphView.tsx (that direction is one-way). GraphView.tsx re-exports it, so every
 *  existing import site keeps working. */
export const ART_RADIUS = 14;
/** The gap separation() leaves between two settled discs (GraphView.tsx's collision pass). Moved
 *  here alongside ART_RADIUS for the same reason: it is half of a card's real footprint. */
export const COLLISION_PAD = 5;
/** A card's footprint including its share of the gap collision leaves between two discs. */
export const CARD_FOOTPRINT_R = ART_RADIUS + COLLISION_PAD / 2;
/** Occupancy a damped force layout actually reaches, NOT hexagonal packing's 0.9069. Measured
 *  (Task 12, arm A1a/A2b, ten trials each on inalla.txt against `2026-08-07-room-size-measurement-
 *  report.md`): PACK trades escapes against intrusions, monotonically -- a smaller PACK makes a
 *  bigger circle for the same card count, so single-room escapes fall (13 -> 5 -> 2 totalled
 *  across ten trials, at PACK 0.7 / 0.6 / 0.5) but the bigger circles overlap more, so intrusions
 *  rise the same direction (1 -> 8 -> 26). The plan's priority is the 1-room bucket reaching 0, so
 *  0.5 wins even though it costs the most intrusions of the three tried. */
export const PACK = 0.5;
/** The floor, per the user's ruling: a one-card room still draws big enough to read as a room. */
const MIN_ROOM_CARDS = 3;

/** How big a room's circle is: an AREA argument, not a picked number. `n` discs of footprint
 *  radius CARD_FOOTPRINT_R need `n * pi * CARD_FOOTPRINT_R^2` of area; divide by PACK occupancy
 *  and solve for R.
 *
 *  It has to be area-derived because the circle is a CONTAINER now (see GraphView.tsx's
 *  containment force), not a hull drawn around wherever the layout left things: a radius too
 *  small for its own members is a permanent fight between containment and collision.
 *
 *  `target` inside the max is what preserves the role preset's finding -- an empty `BOARD WIPES
 *  0/3` draws at the 3-card size, an empty `0/10` draws bigger. Count is in NODES and target is
 *  in COPIES; taking the max of two different units is deliberate and approximate, and is the
 *  same asymmetry roomTallies already documents.
 *
 *  Sizes at the measured PACK 0.5 (was 0.6; see PACK's doc comment): 3 -> 40 - 10 -> 74 -
 *  36 -> 140 - 95 -> 227 world units. For scale, 99 discs at the
 *  33-unit spacing collision settles them to occupy a disc of radius ~165, so a room holding the
 *  whole deck is roomier than the deck's natural spread and containment barely engages on it. */
export function roomRadius(count: number, target: number): number {
  return CARD_FOOTPRINT_R * Math.sqrt(Math.max(count, target, MIN_ROOM_CARDS) / PACK);
}

/** How far outside the occupied cluster empty rooms are parked, as a multiple of the cluster's own
 *  radius. Above 1 so an empty room never sits on top of an occupied one. */
const EMPTY_ORBIT = 1.45;

/** Each room is a circle centred on its members' centroid, sized by HOW MANY members it has
 *  (roomRadius above) rather than by how far apart the force layout happened to leave them.
 *
 *  This used to be the enclosing circle -- radius out to the furthest member's far rim -- which
 *  made membership true by construction: a card in two rooms was inside both because both were
 *  DEFINED to enclose it. That is gone. Enclosure is now a strong tendency with a measured escape
 *  count, produced by GraphView.tsx's containment force, not a guarantee. It is the best
 *  available: circles cannot realise an arbitrary Euler diagram past three sets, so no radius rule
 *  and no force can put a WUBRG card inside all five of its colour rooms at once.
 *
 *  The fallback for that was already built and already documented -- rimArcs' own comment calls
 *  the rim "the AUTHORITATIVE membership signal, and the lens a card sits in is the bonus".
 *
 *  Centroid stays: a centroid always lies inside its own circle, so pulling members inward moves
 *  the centroid toward where they already are and the feedback loop converges rather than chasing
 *  itself.
 *
 *  There is no target floor on an occupied room beyond roomRadius' own max(). The label states
 *  underfill exactly; the circle does not try to. */
export function roomLayout(
  members: readonly RoomMember[],
  rooms: readonly { id: RoomId }[],
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
  for (const room of rooms) {
    const held = byRoom.get(room.id);
    if (!held || held.length === 0) continue;
    let sx = 0, sy = 0;
    for (const m of held) { sx += m.x; sy += m.y; }
    // held.length is the number of NODES drawn for this room, which is what a radius has to pack.
    // tallies' own `count` is over COPIES, from a different pass, and is not interchangeable.
    out.set(room.id, {
      x: sx / held.length,
      y: sy / held.length,
      r: roomRadius(held.length, tallies.get(room.id)?.target ?? 0),
    });
  }

  // Empty rooms have no centroid. Park them in a ring outside everything occupied, in the given
  // rooms' order, so they are visible and cannot overlap a room that holds cards. A room a member
  // claims but that is absent from `rooms` never appears here -- a stale membership must not
  // resurrect a room the caller didn't ask for.
  const empties = rooms.filter((room) => !out.has(room.id));
  if (empties.length > 0) {
    let cx = 0, cy = 0, spread = 0;
    const occupied = [...out.values()];
    for (const c of occupied) { cx += c.x; cy += c.y; }
    if (occupied.length > 0) {
      cx /= occupied.length; cy /= occupied.length;
      for (const c of occupied) spread = Math.max(spread, Math.hypot(c.x - cx, c.y - cy) + c.r);
    }
    empties.forEach((room, i) => {
      const r = roomRadius(0, tallies.get(room.id)?.target ?? 0);
      const angle = (i / empties.length) * Math.PI * 2;
      const orbit = spread * EMPTY_ORBIT + r;
      out.set(room.id, { x: cx + Math.cos(angle) * orbit, y: cy + Math.sin(angle) * orbit, r });
    });
  }
  return out;
}
