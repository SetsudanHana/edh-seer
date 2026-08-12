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

/** How alike two rooms' memberships must be to draw as one. Measured across both fixtures and all
 *  five presets: the only pair at or above this is Sorin's plains/swamp at 0.67. The next candidate
 *  anywhere is inalla's wizard/human at 0.48, which is a NESTING case and must not merge -- so the
 *  gap either side of 0.6 is wide, and this is not a knife-edge. */
const MERGE_JACCARD = 0.6;

/** Values whose member sets nearly coincide, grouped so they draw as ONE room.
 *
 *  Two rooms holding almost the same cards get almost the same centroid, and roomRadius gives them
 *  almost the same radius for almost the same count -- so they land as two near-coincident circles
 *  of equal size. The few cards in one but not the other then have NO legal position: inside A,
 *  outside B, with nothing between them. Measured on Sorin, where `plains`(5) and `swamp`(5) share
 *  4 dual lands: the lone basic Plains and basic Swamp were unplaceable on 10 of 10 seeds, the only
 *  deterministic failures on that board.
 *
 *  Merging is honest here because the rim already carries the truth the geometry cannot -- a card
 *  in the merged room still draws one arc per subtype it actually has, so "Plains / Swamp" says
 *  which of its members are which. rimArcs' own comment states that division.
 *
 *  Jaccard, NOT containment: `wizard`(33) strictly CONTAINS `faerie`(3) on inalla at containment
 *  1.00, and merging those would produce a 33-card room named after 3 of its members. Jaccard puts
 *  that pair at 0.09 and plains/swamp at 0.67. Nesting is a real problem too, and roomLayout
 *  handles it by sizing the parent for the annulus instead.
 *
 *  ponytail: one greedy pass, each value merged at most once, so a chain A~B~C yields one pair and
 *  a leftover rather than a growing blob. Transitive clustering is what a universal room is made
 *  of; revisit only with a deck that actually produces a chain. */
function mergeNearIdentical(
  values: readonly string[], cards: readonly CardFacts[], valuesOf: (c: CardFacts) => readonly string[],
  minJaccard: number,
): string[][] {
  if (minJaccard <= 0 || values.length < 2) return values.map((v) => [v]);
  const holders = new Map(values.map((v) => [v, new Set(cards.filter((c) => valuesOf(c).includes(v)).map((c) => c.id))]));
  const pairs: { a: string; b: string; j: number }[] = [];
  for (let i = 0; i < values.length; i++) for (let k = i + 1; k < values.length; k++) {
    const A = holders.get(values[i])!, B = holders.get(values[k])!;
    const shared = [...A].filter((x) => B.has(x)).length;
    if (!shared) continue;
    const j = shared / (A.size + B.size - shared);
    if (j >= minJaccard) pairs.push({ a: values[i], b: values[k], j });
  }
  // Closest first, so the tightest pair wins a value that two pairs both want. Ties break on the
  // values themselves -- the room list has to be identical across renders of one deck.
  pairs.sort((x, y) => y.j - x.j || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  const partner = new Map<string, string>();
  for (const { a, b } of pairs) {
    if (partner.has(a) || partner.has(b)) continue;
    partner.set(a, b);
    partner.set(b, a);
  }
  const done = new Set<string>();
  const out: string[][] = [];
  for (const v of values) {
    if (done.has(v)) continue;
    const p = partner.get(v);
    if (p === undefined) { out.push([v]); done.add(v); continue; }
    out.push([v, p]);
    done.add(v);
    done.add(p);
  }
  return out;
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
  /** Jaccard at or above which two values draw as one room. 0 is off. See mergeNearIdentical. */
  minJaccard = 0,
): Preset => ({
  id,
  label,
  rooms: (cards) =>
    mergeNearIdentical(byCount(cards, valuesOf, minRoom), cards, valuesOf, minJaccard)
      .map((group, i) => ({
        // A one-value group keeps its value as the id, so an unmerged room is byte-identical to
        // what it was before merging existed -- no rekeying of anything holding a room id.
        id: group.join("+"),
        label: group.join(" / "),
        hue: hueAt(i),
        test: (c) => group.some((v) => valuesOf(c).includes(v)),
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
  derived("subtype", "Subtype", (c) => c.subtypes, MIN_ROOM_CARDS, MERGE_JACCARD),
];
