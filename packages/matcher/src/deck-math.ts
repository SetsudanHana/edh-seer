import { minCopies, pAtLeast, seen } from "@mtg/engine";
import type { DeckMath } from "@mtg/engine";
import { deckAvailability } from "./availability.js";
import { detectAnswerClasses } from "./build.js";
import { manaAudit } from "./mana-audit.js";
import { recommendedLands } from "./land-count.js";
import { winconReport } from "./wincon.js";
import { pressureCurve, STARTING_LIFE } from "./pressure.js";
import { deckCastability } from "./castability.js";
import type { DeckCard, Hierarchy } from "./types.js";

/** The classes the doctrine says every deck should be able to answer (design §12.3), in the order
 *  they are reported.
 *
 *  Reported even at ZERO, always: 27 of the 71 calibration decks carry no artifact removal and 26
 *  no enchantment removal, and a table that lists only what a deck has cannot say so. The absent
 *  row is the finding. */
export const ANSWER_CLASSES = [
  "creature", "artifact", "enchantment", "planeswalker", "land", "graveyard",
] as const;

/** How many demand shapes reach the report. The tail is long and mostly single-consumer noise;
 *  the panel is a summary, and `bin/deck-availability.ts` prints all of them. */
const DEMAND_ROWS = 6;

/** How many of the hardest casts reach the report. */
const CASTABILITY_ROWS = 4;

/** The turn a deck with NO combat clock is priced at: the median measured clock across the 71
 *  calibration decks, which is 9.5, taken DOWN to 9.
 *
 *  Measured rather than chosen -- the fixed turn 5 this replaces was a placeholder nothing
 *  anchored, and design §10.8's whole complaint is that target turns are Tier C guesses. Rounded
 *  down because a shorter horizon sees fewer cards and so understates availability: if this default
 *  is wrong, it should be wrong in the direction that does not flatter the deck. */
export const CORPUS_MEDIAN_CLOCK = 9;

/** The confidence `required_k` inverts: "more often than not, this deck has an answer of this class
 *  in hand by its own clock" (design §12.3, owner's call 2026-08-11).
 *
 *  CHOSEN AGAINST MEASUREMENT, which is the whole reason it is not the spec's proposed 75%. At the
 *  corpus median clock of T9, the count each threshold demands and the decks of 71 that clear it:
 *
 *  | threshold | k | creature | artifact | enchantment | planeswalker | graveyard | land |
 *  |---|---|---|---|---|---|---|---|
 *  | 50% | 4 | 56 | 31 | 19 | 24 | 9 | 6 |
 *  | 60% | 6 | 38 |  9 |  9 |  9 | 1 | 2 |
 *  | 75% | 8 | 19 |  4 |  3 |  3 | 0 | 0 |
 *  | 90% | 13 | 1 |  0 |  0 |  0 | 0 | 0 |
 *
 *  At 75% two classes are 0/71 and nothing else clears 27%; at 90% the whole corpus fails
 *  everything. A gauge that reads "broken" on all 71 decks cannot rank them, and the roadmap's "Tier
 *  C" note understated the problem — 75% is not merely unanchored, it is SATURATED.
 *
 *  The low absolute pass rates at 50% are not a mis-set bar. The doctrine's claim is precisely that
 *  decks under-run graveyard hate and land interaction, and 9/71 and 6/71 is that claim measured. */
export const REQUIRED_CONFIDENCE = 0.5;

/** The deck-math block of a report: what the deck demands of itself, and what it can answer.
 *
 *  Every number here is a probability of having DRAWN something by a turn, so all of
 *  `hypergeometric.ts`'s caveats ride along -- no mulligans, no opponent, and `seen(T) = 7 + T`
 *  ignores card draw, which makes every figure conservative for a deck that draws.
 *
 *  Supply is UNWEIGHTED: four Ashnod's Altars and four Fling effects count the same. That needs the
 *  scaling-channel repair (`2026-08-06-count-matters-design.md` §§5-7), and until then the caveat
 *  travels with the number rather than the number travelling alone. */
export function computeDeckMath(
  deck: readonly DeckCard[],
  hierarchy: Hierarchy,
  commanderNames: readonly string[] = [],
  turnOverride?: number,
  opts: { comboCards?: readonly string[] } = {},
): DeckMath {
  const commanders = new Set(commanderNames);
  const library = deck.length - deck.filter((dc) => commanders.has(dc.card.name)).length;
  const classes = detectAnswerClasses([...deck]);

  // THE DECK'S OWN CLOCK SETS THE HORIZON everything else is priced against (project owner's call,
  // and the payoff design §12.8 promised for this step). "Do I have an artifact answer in time"
  // needs a deadline, and a fixed turn 5 was a placeholder for every deck alike.
  //
  // THE ASSUMPTION, stated because it is doing real work: your clock stands in for the GAME's
  // length. The threat you are answering is an opponent's, and no opponent is modelled anywhere in
  // this layer -- pod analysis is blocked on a data layer that holds one deck. A deck that kills on
  // turn 6 is priced as though the game ends on turn 6, which is right if the table is racing it and
  // wrong if it is being ignored.
  //
  // The clock is optimistic (nobody blocks), so it lands EARLY, which prices fewer cards seen and
  // understates availability. The bias runs against flattering the deck, which is the direction to
  // be wrong in.
  //
  // EXCEPT FOR ONE CASCADE, WHICH RUNS THE OTHER WAY AND HITS THE RAMP DECKS HARDEST (2026-08-19).
  // `expectedPower` gates a creature on `manaValue <= turn` and models no ramp, so a deck that ramps
  // has its fatties dated LATE and its clock reads late with them. A late clock is a bigger `turn`,
  // hence a bigger `seen(turn)`, hence availability OVERSTATED and `required` understated -- for
  // exactly the decks that accelerate. Everything else in this layer is conservative; this is not,
  // and the two do not cancel in any measured way.
  // `specs/2026-08-19-clock-and-mana-model-review.md` §3.
  const curve = pressureCurve(deck, { commanderNames });
  const clockTurn = curve.find((p) => p.cumulative >= STARTING_LIFE)?.turn;
  const clock = {
    ...(clockTurn !== undefined ? { turn: clockTurn } : {}),
    powerAtFive: Math.round(curve[4].power * 10) / 10,
  };
  const turn = turnOverride ?? clockTurn ?? CORPUS_MEDIAN_CLOCK;
  const turnSource: DeckMath["turnSource"] =
    turnOverride !== undefined ? "override" : clockTurn !== undefined ? "clock" : "corpus-median";

  const answers = ANSWER_CLASSES.map((cls) => {
    const found = classes.get(cls);
    const members = found?.cards ?? new Set<string>();
    const fromCommandZone = [...members].some((n) => commanders.has(n));
    const inLibrary = [...members].filter((n) => !commanders.has(n)).length;
    return {
      class: cls,
      count: members.size,
      // Counted over the same membership as `count`, commanders included -- a commander that
      // exiles is still an exiling answer, and the pair only reads correctly if both sides of it
      // count the same cards.
      exiling: found?.exiling.size ?? 0,
      recurring: found?.recurring.size ?? 0,
      fromCommandZone,
      available: fromCommandZone ? 1 : pAtLeast(1, inLibrary, seen(turn), library),
      // The doctrine states a confidence and the maths derives the count -- the inversion of the
      // `available` line directly above it, against the same turn and the same library. A commander
      // owes nothing to a draw probability, so its class requires nothing.
      required: fromCommandZone ? 0 : minCopies(1, turn, REQUIRED_CONFIDENCE, library),
    };
  });

  const demand = deckAvailability(deck, hierarchy, { turn, commanderNames: [...commanderNames] })
    .filter((r) => r.consumers > 0)
    .slice(0, DEMAND_ROWS)
    .map((r) => ({
      key: r.key,
      consumers: r.consumers,
      suppliers: r.suppliers,
      available: r.available,
      fromCommandZone: r.fromCommandZone,
    }));

  const colors = manaAudit(deck, { commanderNames }).map((r) => ({
    color: r.color,
    supplied: r.supplied,
    ...(r.worst
      ? { worst: { pips: r.worst.pips, turn: r.worst.turn, required: r.worst.required, cards: r.worst.cards } }
      : {}),
  }));

  const wincons = winconReport(deck, { comboCards: opts.comboCards });

  const cast = deckCastability(deck, { commanderNames });
  const castability = {
    // The hardest few only: a per-card list of 99 rows is a spreadsheet, not a readout, and the
    // cards a reader can act on are the ones at the bottom.
    cards: cast.cards.slice(0, CASTABILITY_ROWS).map((c) => ({
      name: c.name, turn: c.turn, mana: c.mana!, manaWithRocks: c.manaWithRocks!,
      colors: c.colors.map((x) => ({ color: x.color, pips: x.pips, p: x.p })),
    })),
    refused: cast.refused,
    biases: cast.biases,
  };

  const rec = recommendedLands(deck, { commanderNames });
  const lands = {
    actual: rec.actual,
    target: rec.target,
    avgManaValue: Math.round(rec.avgManaValue * 100) / 100,
    rampPlusDraw: rec.rampPlusDraw,
    fastMana: rec.fastMana,
    // Carried so the panel can say why this land count differs from the build row's: a modal DFC
    // with a land back is a LAND to the type-line test the build categories use and a SPELL to this
    // regression, which prices it at 0.74 or 0.38 of one. Two numbers on one screen with no
    // explanation reads as a defect in the report.
    mdfc: rec.mdfcUntapped + rec.mdfcTapped,
  };

  return {
    turn, turnSource, seen: seen(turn), library, answers, clock, wincons, lands, colors,
    castability, demand,
  };
}
