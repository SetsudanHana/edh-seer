import { pAtLeast, seen } from "@mtg/engine";
import { buildCensus } from "./census.js";
import type { DeckCard, Hierarchy } from "./types.js";

/** One demand shape in a deck, and how likely you are to have anything that answers it.
 *
 *  The instrument the user asked for, in the framing that survived the design: *"you have 20 cards
 *  that care about creatures dying but only 4 sac outlets"* is TWO claims, and only one of them is
 *  a ratio. Whether one outlet can keep up with 20 payoffs is a throughput question a count cannot
 *  answer -- a free repeatable outlet feeds all 20 forever, four one-shot sacrifices feed almost
 *  nothing. Whether you will have an outlet AT ALL is a drawing question, it is exact, and it is
 *  the defect in that example: 4 copies in 99 is 28% by turn 5. */
export interface AvailabilityRow {
  /** The consumer shape, from the census's own key -- `dies:type:creature`, `dies:subtype:vampire`.
   *  Deliberately NOT rolled up on the first type: those two are different demands, and merging
   *  them would report a vampire deck as having supply it does not have. */
  key: string;
  /** Deck cards whose trigger listens for this. */
  consumers: number;
  /** Deck cards emitting an event that satisfies it, under the engine's subsumption rules -- a
   *  card emitting `dies:creature:you` supplies a `dies:permanent:any` listener. Includes any
   *  commander. */
  suppliers: number;
  /** Suppliers actually in the library, i.e. `suppliers` minus the commanders. The number the
   *  probability is computed from. */
  librarySuppliers: number;
  /** A commander supplies this shape, so it is available in every game (stub §10.1: the commander
   *  is the only card with P = 1). When true, `available` is 1 regardless of `librarySuppliers`. */
  fromCommandZone: boolean;
  /** P(at least one supplier available by `turn`).
   *
   *  **Null for a self-supplied shape**, where the question does not apply: the GAME supplies
   *  "whenever a creature attacks", so there is no card to draw and a 0% would invent a hole the
   *  deck does not have. Null rather than 1, because "you always have it" is also a claim -- it
   *  needs creatures on the board, which this layer does not model. */
  available: number | null;
  /** See `available`. Mirrors the census's own `selfSupplied`. */
  selfSupplied: boolean;
  /** The turn `available` was computed for, carried so a row can be read on its own. */
  turn: number;
}

export interface AvailabilityOptions {
  /** Cards seen is `7 + turn`, so this is the deadline the demand is priced against. Turn 5 is the
   *  spec's default working turn for a mid-game engine. */
  turn?: number;
  /** Names as they appear on the cards. Used for two different things: removing them from the
   *  library size, and spotting a supplier that never needs drawing. */
  commanderNames?: string[];
}

/** Deck-scoped supply and demand, priced by when you draw it.
 *
 *  This is `buildCensus` restricted to one deck -- the same function the corpus census uses, at a
 *  different scope, deliberately not a second implementation. Its comments are a list of the ways
 *  this goes wrong and they all apply here.
 *
 *  WHAT IT DOES NOT DO, and each is a real limit rather than a rounding error:
 *  - **Supply is UNWEIGHTED.** Four Ashnod's Altars and four Fling effects score identically.
 *    `reason.repeatability` and `effect.scaling` are the axis that separates them, and the scaling
 *    channel currently derives as zero (`2026-08-06-count-matters-design.md` §§5-7 unimplemented).
 *    Weighted supply waits on that repair; unweighted is still worth having.
 *  - **No chain discovery.** One link, producer to consumer. A depth-3 engine is three of these
 *    rows and this function will not tell you they are the same engine.
 *  - **`seen(T) = 7 + T` ignores draw**, so every figure is conservative for a deck that draws, and
 *    there are no mulligans and no opponent. See `hypergeometric.ts`. */
/** Verbs the TURN STRUCTURE supplies, not a card. The tagger's own vocabulary note says it: "no
 *  card supplies your upkeep", which is why these correctly form no edges.
 *
 *  Without this they read as the worst holes on the board -- three cards wanting `end-step:any`
 *  against zero suppliers is 0%, i.e. "your deck cannot reach its own end step". Caught on the
 *  running app, not by a test, because the fixtures have no phase triggers. */
const PHASE_VERBS = new Set(["upkeep", "begin-combat", "end-step"]);

export function deckAvailability(
  deck: readonly DeckCard[],
  hierarchy: Hierarchy,
  opts: AvailabilityOptions = {},
): AvailabilityRow[] {
  const turn = opts.turn ?? 5;
  const commanders = new Set(opts.commanderNames ?? []);

  // The census indexes cards by their ordinal in the iteration it is given, so the array handed to
  // it IS the index space -- keep one array and use it for both.
  const withTags = deck.filter((dc): dc is DeckCard & { tags: NonNullable<DeckCard["tags"]> } => dc.tags != null);
  if (withTags.length === 0) return [];

  const census = buildCensus(withTags.map((dc) => dc.tags), hierarchy, { members: true });
  const isCommander = withTags.map((dc) => commanders.has(dc.card.name));

  // One entry per physical card, so a 3-of basic is three entries -- the same convention
  // computeBuild relies on for its land count. Cards the tagger could not read still take up a
  // slot in the library even though they can supply nothing, so the FULL deck is counted here,
  // not just the tagged ones.
  const library = deck.length - deck.filter((dc) => commanders.has(dc.card.name)).length;

  return census.consumers.map((row) => {
    const supplierIdx = row.counterpartIndices ?? [];
    const fromCommandZone = supplierIdx.some((i) => isCommander[i]);
    const librarySuppliers = supplierIdx.filter((i) => !isCommander[i]).length;
    // Combat is self-supplied because every creature can attack; a phase is self-supplied because
    // every turn has one. Different reasons, same answer: there is no card to draw.
    const selfSupplied = row.selfSupplied || PHASE_VERBS.has(row.key.split(":")[0]);
    return {
      key: row.key,
      consumers: row.cards,
      suppliers: supplierIdx.length,
      librarySuppliers,
      fromCommandZone,
      selfSupplied,
      available: selfSupplied
        ? null
        : fromCommandZone
          ? 1
          : pAtLeast(1, librarySuppliers, seen(turn), library),
      turn,
    };
  });
}
