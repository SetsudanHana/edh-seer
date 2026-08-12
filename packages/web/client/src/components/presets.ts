import type { CardGraph, GraphNode } from "../types.js";
import { MIN_ROOM_CARDS, ROOMS, ROOM_HUE, roomsForCard, type RoomId } from "./deck-rooms.js";

/** What a room's `test` is allowed to look at. Deliberately flat and small: a predicate that can
 *  reach the whole graph is a predicate nobody can reason about, and every fact here is already
 *  reified as an edge the graph carries. */
export interface CardFacts {
  id: string;
  name: string;
  roles: readonly string[];
  /** FRONT face only -- and so is `subtypes`, so the Type and Subtype presets narrow together.
   *
   *  This is right for a TRANSFORM or FLIP card, whose back is reached by transforming a permanent
   *  already in play. It is NOT what the engine says for a modal DFC / adventure / split, where
   *  every face is castable in its own right (DERIVE_VERSION 30, `FRONT_FACE_ONLY` is an
   *  allow-list of the transform/flip layouts, not a blanket rule) -- so the board calls Malakir
   *  Rebirth // Malakir Bereavement an Instant and never a Land, while the corpus counts both
   *  halves. Open contract question, not a settled reading: the FACE edges for the other faces are
   *  already in the graph if the board should match the engine. */
  types: readonly string[];
  subtypes: readonly string[];
  /** Colour IDENTITY, which is card-level -- the FACE-level COLOR edges are a different question. */
  colors: readonly string[];
  manaValue: number;
  copies: number;
  /** True if this card's name is one of report.combos[].cards -- the only thing anyone downstream
   *  needs to know about combo membership. See the role preset's `test` below. */
  comboCard: boolean;
}

/** One pass over the graph. Cheap enough to run per render, but callers should memoise on `graph`
 *  identity because the paint loop must not allocate. `comboCardNames` defaults to empty so every
 *  existing call site keeps compiling untouched. */
export function cardFacts(
  graph: CardGraph,
  comboCardNames: ReadonlySet<string> = new Set(),
): CardFacts[] {
  const byId = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));
  const out: CardFacts[] = [];

  // from -> edges, so each card is one lookup rather than a scan of every edge.
  const from = new Map<string, { to: string; kind: string; index?: number }[]>();
  for (const e of graph.edges) {
    const list = from.get(e.from);
    if (list) list.push(e);
    else from.set(e.from, [e]);
  }
  const labelsOf = (id: string, kind: string): string[] =>
    (from.get(id) ?? []).filter((e) => e.kind === kind).map((e) => byId.get(e.to)?.label ?? "");

  for (const n of graph.nodes) {
    if (n.kind !== "card") continue;
    // index === 0 is the front face. A single-faced card still gets one FACE edge, and its index
    // is 0, so there is no special case for the common shape.
    const front = (from.get(n.id) ?? []).find((e) => e.kind === "FACE" && (e.index ?? 0) === 0);
    const cmc = labelsOf(n.id, "CMC")[0];
    out.push({
      id: n.id,
      name: n.label,
      roles: n.roles ?? [],
      types: front ? labelsOf(front.to, "TYPE") : [],
      subtypes: front ? labelsOf(front.to, "SUBTYPE") : [],
      colors: labelsOf(n.id, "IDENTITY"),
      manaValue: cmc === undefined ? 0 : Number(cmc),
      copies: n.copies ?? 1,
      comboCard: comboCardNames.has(n.label),
    });
  }
  return out;
}

export interface Room {
  id: RoomId;
  label: string;
  hue: string;
  test(card: CardFacts): boolean;
  /** Role preset only: the BuildCategory values whose targets this room's tally sums. */
  categories?: string[];
  /** Claims cards no other room in the preset claimed. At most one per preset. */
  fallback?: boolean;
}

export interface Preset {
  id: string;
  label: string;
  /** Fixed presets ignore the argument; derived ones read the deck. */
  rooms(cards: readonly CardFacts[]): Room[];
}

/** Every room a card is in. The fallback is applied ONLY if nothing else claimed the card, which is
 *  what makes it a fallback rather than a room that is always on. */
export function roomsForFacts(rooms: readonly Room[], card: CardFacts): RoomId[] {
  const hit = rooms.filter((r) => !r.fallback && r.test(card)).map((r) => r.id);
  if (hit.length > 0) return hit;
  const fb = rooms.find((r) => r.fallback);
  return fb && fb.test(card) ? [fb.id] : [];
}

/** Distinct values across the deck, ordered by how many cards carry each. Ties break on the value
 *  so the board is stable across renders of one deck -- the arc cap consumes this order, so an
 *  unstable sort would make which arc gets dropped vary frame to frame.
 *
 *  `minCount` is the density floor (default 1, i.e. off). It counts DISTINCT CARDS, not copies:
 *  the floor exists because a circle below MIN_ROOM_CARDS cannot be drawn honestly, and what a
 *  radius packs is discs -- the same nodes-vs-copies line roomLayout already draws between
 *  `held.length` and `tallies.count`. */
function byCount(
  cards: readonly CardFacts[], valuesOf: (c: CardFacts) => readonly string[], minCount = 1,
): string[] {
  const n = new Map<string, number>();
  for (const c of cards) for (const v of valuesOf(c)) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([v]) => v);
}

/** Derived rooms have no curated palette, so hues come off a fixed wheel by index. Deterministic
 *  for a given deck because the order above is. */
const WHEEL = ["#1c8db7", "#b08e1d", "#5b40f6", "#146d9e", "#21a28f", "#277310", "#6b89f9", "#a3446e"];
const hueAt = (i: number): string => WHEEL[i % WHEEL.length];

const derived = (
  id: string,
  label: string,
  valuesOf: (c: CardFacts) => readonly string[],
  /** Density floor: how many distinct cards a value needs before it earns a room. 1 is off, and
   *  is right for every preset whose rare values are the FINDING -- a 2-card `7+` bucket is the
   *  curve's tail, a 2-card enchantment count is the deck's composition. Only Subtype sets it,
   *  because only there does a rare value mean "not a theme" rather than "here is the number". */
  minRoom = 1,
): Preset => ({
  id,
  label,
  rooms: (cards) =>
    byCount(cards, valuesOf, minRoom).map((v, i) => ({
      id: v,
      label: v,
      hue: hueAt(i),
      test: (c) => valuesOf(c).includes(v),
    })),
});

/** 7+ is a bucket, not a value: a deck's 9-drop and its 12-drop are the same fact about the curve,
 *  and a room per distinct high value is a row of one-card rooms. */
const mvBucket = (c: CardFacts): readonly string[] => [c.manaValue >= 7 ? "7+" : String(c.manaValue)];

export const PRESETS: Preset[] = [
  {
    id: "role",
    label: "Role",
    // The one preset with a fixed room list, because it is the only one with build targets and the
    // only one where an EMPTY room is the finding ("BOARD WIPES 0/3").
    rooms: () =>
      ROOMS.map((r) => ({
        id: r.id,
        label: r.label,
        hue: ROOM_HUE[r.id],
        categories: r.categories,
        fallback: r.id === "strategy",
        // Delegates to the shipped implementation rather than restating it: roomsForCard also
        // folds in combo membership, and two copies of that rule would drift. `c.comboCard` is
        // per-card, but roomsForCard's third argument is a set of NAMES (it was designed to check
        // deck-wide combo membership in one call per card) -- reconstructing a one-or-zero-element
        // set here is the smallest way to hand it what it wants without changing its signature.
        test: (c: CardFacts) => roomsForCard([...c.roles], c.name, new Set(c.comboCard ? [c.name] : [])).includes(r.id),
      })),
  },
  derived("type", "Type", (c) => c.types),
  derived("colour", "Colour", (c) => c.colors),
  derived("manaValue", "Mana value", mvBucket),
  // The one preset with a density floor. Subtype answers "is this deck actually a Vampire deck?",
  // and a subtype carried by one card is not a theme -- drawn as a room it is the board claiming
  // something the deck does not support. Measured before the floor: Sorin 19 rooms with ELEVEN
  // holding a single card, inalla 21 with eleven. Land subtypes are deliberately NOT excluded
  // (owner's call, against the tutor gate's precedent): Urza's Saga and Cave decks are real.
  derived("subtype", "Subtype", (c) => c.subtypes, MIN_ROOM_CARDS),
];
