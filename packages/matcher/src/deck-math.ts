import { minCopies, pAtLeast, seen } from "@mtg/engine";
import type { DeckMath } from "@mtg/engine";
import { loadAnswerPool, identityKey, POOL_CLASSES, commanderIdentity } from "./answer-pool.js";
import { deckAvailability } from "./availability.js";
import { detectAnswerClasses, gatedLandsTarget, adjustedTargets } from "./build.js";
import { manaAudit } from "./mana-audit.js";
import { recommendedLands, type LandRecommendation } from "./land-count.js";
import { winconReport } from "./wincon.js";
import { pressureCurve, STARTING_LIFE } from "./pressure.js";
import { cardCastability, deckCastability } from "./castability.js";
import type { CastCurve } from "./goldfish.js";
import type { DeckCard, Hierarchy } from "./types.js";
import { ARCHETYPE_LABELS, type Archetype } from "./archetypes.js";
import { topdeckPayoffs } from "./topdeck.js";

/** The classes the doctrine says every deck should be able to answer (design §12.3), in the order
 *  they are reported. Derived from `POOL_CLASSES` (whole-branch review MINOR 2) rather than a
 *  second hand-typed copy of the same six names -- this one keeps `graveyard`, unlike
 *  `answer-coverage.ts`'s `COVERAGE_CLASSES`, because the panel reports it even though scoring does
 *  not (design §3).
 *
 *  Reported even at ZERO, always: 27 of the 71 calibration decks carry no artifact removal and 26
 *  no enchantment removal, and a table that lists only what a deck has cannot say so. The absent
 *  row is the finding. */
export const ANSWER_CLASSES = POOL_CLASSES;

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
  // `landRecommendation`: task 9 -- `analyze.ts` computes `recommendedLands` once, up front, and
  // passes it here so this function does not call `karstenLands` a second time for the same deck.
  // Absent for every other caller (this file's own tests, `answer-availability.ts`), which fall
  // back to computing it themselves; `land-count.ts` is still the only place the regression runs.
  // `primary`: task 9 fix F1 -- the SAME archetype `computeBuild` scores against, so its
  // `ARCHETYPE_TARGET_DELTAS` (landfall's `lands: +4`) reaches this panel row too. Before this fix
  // `computeBuild` alone applied the delta, so a landfall deck's panel said "wants 39" beside a
  // score that had silently scored it against 43 -- the exact disagreement task 9 exists to close.
  // `castCurves`: the simulated per-card castability, run ONCE in `analyze.ts` and shared, because
  // both this panel and `report.manaAvailability` are read off the same two policy arms and running
  // four simulations for two answers off the same trials would be pure waste. Absent for callers
  // that do not need the castability panel (this file's own tests, `answer-availability.ts`), which
  // then get an empty map and a row of refusals rather than a wrong number.
  opts: {
    comboCards?: readonly string[];
    landRecommendation?: LandRecommendation;
    primary?: Archetype;
    castCurves?: ReadonlyMap<string, CastCurve>;
    manaBudget?: readonly number[];
  } = {},
): DeckMath {
  const castCurves = opts.castCurves ?? new Map<string, CastCurve>();
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
  // THE CASCADE THAT RAN THE OTHER WAY IS CLOSED (roadmap L4, 2026-08-26). It read: `expectedPower`
  // gates a creature on `manaValue <= turn`, nothing sums what the board deployed against what the
  // board could pay, so a deck that ramps had its fatties dated LATE and its clock read late with
  // them -- a bigger `turn`, a bigger `seen(turn)`, availability OVERSTATED and `required`
  // understated, for exactly the decks that accelerate. It was the one bias in this layer that
  // flattered the deck. `manaBudget` is the simulated median mana curve, so the clock is now priced
  // against a board that has to pay for itself AND that ramp reaches.
  //
  // ABSENT FOR A CALLER THAT HAS NO SIMULATION (this file's tests, `answer-availability.ts`), which
  // then get the unbudgeted clock -- the same degradation `castCurves` already makes, and the same
  // reason: a wrong number here is worse than the older one.
  // `specs/2026-08-19-clock-and-mana-model-review.md` §3.
  const curve = pressureCurve(deck, { commanderNames, ...(opts.manaBudget ? { manaBudget: opts.manaBudget } : {}) });
  const clockTurn = curve.find((p) => p.cumulative >= STARTING_LIFE)?.turn;
  const clock = {
    ...(clockTurn !== undefined ? { turn: clockTurn } : {}),
    powerAtFive: Math.round(curve[4].power * 10) / 10,
  };
  const turn = turnOverride ?? clockTurn ?? CORPUS_MEDIAN_CLOCK;
  const turnSource: DeckMath["turnSource"] =
    turnOverride !== undefined ? "override" : clockTurn !== undefined ? "clock" : "corpus-median";

  // The commanders' identity (CR 903.4), for the pool row below -- never the union of all 100
  // cards. `commanderIdentity` (answer-pool.js, whole-branch review MINOR 1) is the one place this
  // is derived, shared with `analyze.ts`'s identical need, so the panel's `pool` row and the
  // score's `poolShare` can never describe two different colour identities for the same deck.
  const identity = commanderIdentity(deck, commanders);
  const poolRow = identity ? loadAnswerPool()[identityKey(identity)] : undefined;

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
      /** How many answers of this class EXIST inside the deck's colour identity, corpus-wide.
       *  Absent when no commander was detected -- an identity we cannot read must not become a
       *  claim about what the deck's colours can do. */
      ...(poolRow?.[cls] !== undefined ? { pool: poolRow[cls] } : {}),
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
      ? {
        worst: {
          pips: r.worst.pips, turn: r.worst.turn, required: r.worst.required,
          // BOTH ENDS REACH THE READER. `required` prices the free mulligan and `requiredRaw` does
          // not; the keep band is a LAND band, so the first over-states the help for a colour and
          // the second under-states it. A renderer showing one number alone picks a model silently.
          requiredRaw: r.worst.requiredRaw, cards: r.worst.cards,
        },
      }
      : {}),
  }));

  const wincons = winconReport(deck, { comboCards: opts.comboCards });

  const cast = deckCastability(deck, castCurves);
  // THE COMMANDER'S OWN ROW (roadmap K5). `deckCastability` prices every nonland and then reports
  // the HARDEST few; the commander is the one card a reader looks for BY NAME, and on a 6-drop it
  // is routinely nowhere near the hardest four. Same function, same two axes, no second model.
  // WORKS FROM THE COMMAND ZONE, read off the printed cue. Inalla's eminence is online turn 1 at
  // zero mana, so a CAST probability is the wrong question for it — and saying so beside the number
  // is the honest surface while the derive fix (J10) is unbuilt. Measured: exactly 1 of the 75
  // commanders across the 71 calibration decks carries such a cue, and it is Inalla; 89 corpus
  // cards print one. RE-MEASURED 2026-08-25 (roadmap J10): this cue matches **84** corpus cards, not
  // the 89 written here originally — corpus drift, corrected in passing rather than left to the next
  // audit. The 1-of-75 figure still holds, and it is still Inalla.
  const COMMAND_ZONE_CUE = /from the command zone|eminence|commander ninjutsu|in the command zone/i;
  const commanderRows = deck
    .filter((dc) => commanders.has(dc.card.name) && !dc.card.typeLine.toLowerCase().includes("land"))
    .map((dc) => cardCastability(dc, castCurves))
    .map((c) => ({
      name: c.name, turn: c.turn, castable: c.castable, mana: c.mana,
      ...(c.refused ? { refused: c.refused } : {}),
    }));
  for (const row of commanderRows) {
    const dc = deck.find((d) => d.card.name === row.name);
    if (dc && COMMAND_ZONE_CUE.test(dc.card.oracleText ?? "")) {
      (row as { commandZoneCaveat?: string }).commandZoneCaveat =
        "part of this commander works from the command zone, so it is doing something before you can cast it";
    }
  }
  const castability = {
    // The hardest few only: a per-card list of 99 rows is a spreadsheet, not a readout, and the
    // cards a reader can act on are the ones at the bottom.
    cards: cast.cards.slice(0, CASTABILITY_ROWS).map((c) => ({
      name: c.name, turn: c.turn, castable: c.castable!, mana: c.mana!,
    })),
    refused: cast.refused,
    biases: cast.biases,
    // ROADMAP I6: cards that put a nonland permanent onto the battlefield FROM HAND. Every figure
    // above prices CASTING, and putting is not casting -- so on a deck holding one of these the
    // percentage on its biggest creature is correct and beside the point. A list, never a rate.
    ...(cast.cheatsIntoPlay.length > 0 ? { cheatsIntoPlay: cast.cheatsIntoPlay } : {}),
    ...(commanderRows.length > 0 ? { commanders: commanderRows } : {}),
  };

  const rec = opts.landRecommendation ?? recommendedLands(deck, { commanderNames });
  // THE SAME GATE `computeBuild` SCORES AGAINST (task 9) -- before this, `target` here was always
  // the regression's raw rounded answer, whatever it was, while the build score fell back to a flat
  // 36 whenever it looked wrong. That let the panel print "wants 50" beside a score that had quietly
  // scored against 36 instead -- two numbers on one screen for one quantity, disagreeing, neither
  // one saying so. `gatedLandsTarget` is the one place that decision is made; both readers call it
  // on the identical rounded input, so they can't disagree again.
  const landsGate = gatedLandsTarget(rec.target);
  // THE SAME `adjustedTargets` CALL `computeBuild` MAKES (task 9 fix F1) -- reusing it, rather than
  // re-adding `ARCHETYPE_TARGET_DELTAS.landfall` here by hand, is what guarantees the two can never
  // diverge again: same function, same `primary`, same gated input, so the same output. `lands` sits
  // outside `GROUPED_LEAVES` (see that set's own comment), so this call touches nothing else in the
  // returned record.
  const finalLandsTarget = adjustedTargets(opts.primary, landsGate.target).lands;
  const archetypeDelta = finalLandsTarget - landsGate.target;
  const lands = {
    actual: rec.actual,
    target: finalLandsTarget,
    targetSource: landsGate.source,
    // The regression's own answer, kept even on a fallback -- "wants 36" with no working when the
    // curve's own math says 50 reads as the report hiding the number it didn't like.
    rawTarget: rec.target,
    // NON-ZERO ONLY WHEN AN ARCHETYPE DELTA WAS FOLDED IN (landfall's `lands: +4` today) -- a
    // silent adjustment is the same defect this task closes for the flat/derived fallback, so it is
    // named here too rather than left for the reader to notice `target !== rawTarget` and wonder
    // why. 0 for every other deck, `archetypeLabel` absent alongside it.
    archetypeDelta,
    ...(archetypeDelta !== 0 && opts.primary ? { archetypeLabel: ARCHETYPE_LABELS[opts.primary] } : {}),
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
    castability, demand, topdeck: topdeckPayoffs(deck, commanderNames),
  };
}
