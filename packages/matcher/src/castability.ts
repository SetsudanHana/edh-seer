import { MAX_PRICED_TURN, type CastCurve } from "./goldfish.js";
import type { DeckCard } from "./types.js";

/** Costs this model cannot represent, and the reason each is refused.
 *
 *  THE HOUSE RULE, applied hard: refuse the card rather than guess it. A silent wrong castability
 *  percentage is worse than a blank, because a reader trusts a percentage absolutely -- and every
 *  one of these makes the printed mana value a lie about what the card costs to cast. */
const REFUSALS: { test: (dc: DeckCard) => boolean; reason: string }[] = [
  {
    test: (dc) => /\{X\}/i.test(dc.card.manaCost ?? ""),
    reason: "X cost — the mana value on the card is not what you pay",
  },
  {
    test: (dc) => /\bdelve\b/i.test(dc.card.oracleText ?? ""),
    reason: "delve — pays with the graveyard, which nothing here models",
  },
  {
    test: (dc) => /\bconvoke\b/i.test(dc.card.oracleText ?? ""),
    reason: "convoke — pays with creatures, which nothing here models",
  },
  {
    test: (dc) => /\baffinity\b|\bimprovise\b/i.test(dc.card.oracleText ?? ""),
    reason: "affinity/improvise — the cost depends on the board",
  },
  {
    // ONLY WHEN *THIS* CARD IS THE ONE CAST FREE, AND ONLY IF IT IS FREE ON THE FIRST CAST.
    // The bare phrase refuses 540 corpus cards where 19 deserve it (roadmap K5a, found by K5
    // reporting the commander's own row):
    //   - 487 use it about ANOTHER card -- Hidetsugu and Kairi's DEATH trigger free-casts the
    //     exiled card, Jodah's trigger free-casts the revealed one. Six of the 71 decks' commanders
    //     were unpriced for that, which is a blank where a real number belongs.
    //   - 34 are REBOUND ("cast this card FROM EXILE"): the second cast is free and the FIRST one
    //     costs its printed mana, so the mana value prices it correctly. Hence the `from exile`
    //     exclusion rather than a bare "this card" test.
    //   - 19 are the real shape -- Deadly Rollick, Flawless Maneuver, Mogg Salvage -- where the card
    //     really can hit the table without its mana cost and the printed value is a lie.
    test: (dc) => /cast this (?:spell|card)(?! from exile)[^.]{0,40}?without paying its mana cost/i
      .test(dc.card.oracleText ?? ""),
    reason: "alternative cost — the card can be cast for free",
  },
];

export interface CardCastability {
  name: string;
  manaValue: number;
  /** The turn this is priced at: the card's own mana value, the same deadline rule the mana audit
   *  uses. You want to cast a 3-drop on turn 3. */
  turn: number;
  /** P(YOU CAN CAST IT) by `turn` -- mana and colours together, as the POLICY interval.
   *
   *  ONE NUMBER, AND IT MEANS WHAT IT SAYS. This module used to report two hypergeometric axes and
   *  refuse to multiply them, correctly: both are driven by the same lands, so the product
   *  under-states, and "mana yes, colour no" is a different deck problem from "colour yes, mana no".
   *  The cost of that refusal was that NO figure here meant "you can cast this card". The simulation
   *  asks the board both questions in the same trial, so the combination is free and the correlation
   *  is handled by construction.
   *
   *  THE INTERVAL IS THE PLAY POLICY, not the two old biases: the low end holds up two mana before
   *  casting an accelerant, the high end spends everything on acceleration and is a CEILING no real
   *  deck plays to. Null when the cost is refused. */
  castable: { low: number; high: number } | null;
  /** THE SAME CELL WITH COLOURS IGNORED -- the diagnostic, and the only reason to keep two numbers.
   *  A card whose `mana` is high and whose `castable` is low has a COLOUR problem, not a ramp
   *  problem, and those are fixed differently. Equal to `castable` when the colours line up. */
  mana: { low: number; high: number } | null;
  /** Present only when `castable` is null: why the model will not price this card. */
  refused?: string;
}

/** Why this card's cost cannot be represented, or undefined. Exported because a caller can want the
 *  REFUSAL without wanting a probability — `commander-ramp.ts` needs to know that an {X} commander's
 *  printed mana value is not what you pay, and re-typing this list there is how two of them drift. */
export function costRefusal(card: DeckCard): string | undefined {
  return REFUSALS.find((r) => r.test(card))?.reason;
}

export function cardCastability(
  card: DeckCard,
  curves: ReadonlyMap<string, CastCurve>,
): CardCastability {
  const manaValue = card.card.manaValue;
  const turn = Math.max(1, Math.round(manaValue));
  const blank = { name: card.card.name, manaValue, turn, castable: null, mana: null };

  const refusal = costRefusal(card);
  if (refusal) return { ...blank, refused: refusal };
  // PAST THE SIMULATION'S HORIZON IS A REFUSAL, not a figure quietly answering a nearer turn.
  if (turn > MAX_PRICED_TURN) {
    return { ...blank, refused: `mana value ${manaValue} — past the ${MAX_PRICED_TURN} turns this model simulates` };
  }
  const curve = curves.get(card.card.name);
  if (!curve || !curve.castable[turn - 1]) {
    return { ...blank, refused: "not priced — the card is not in the simulated library" };
  }
  return { ...blank, castable: curve.castable[turn - 1], mana: curve.mana[turn - 1] };
}

/** A card that puts a NONLAND permanent from your hand onto the battlefield (roadmap I6).
 *
 *  PUTTING IS NOT CASTING, and the owner drew that line deliberately: the permanent never uses the
 *  stack, so it dodges cast triggers and countermagic, and its printed mana cost is never paid.
 *  Every percentage in this module prices CASTING, so in a deck holding one of these the figure on
 *  its biggest creature is correct and beside the point.
 *
 *  A LAND FROM HAND IS EXCLUDED: that is a land drop you already had -- ramp, which
 *  `detectBuildCategories` models -- and it is 52 of the 159 raw matches corpus-wide.
 *
 *  MEASURED before it was built: 107 corpus cards, 10 of the 71 calibration decks, and ALL TEN also
 *  hold a nonland at mana value 6 or more (8 of them at 8 or more), so the caveat always has
 *  something to be about. ZERO of the 107 put the card under an OPPONENT's control. The family was
 *  enumerated by the noun it names -- creature card 30, permanent card 9, artifact card 5, then
 *  singletons down to "construct, robot, or vehicle" -- rather than sampled. */
const CHEATS_INTO_PLAY =
  /put (?:a|an|any number of|up to \w+|target|that|those) [^.]{0,60}?from your hand onto the battlefield/i;
const LAND_FROM_HAND =
  /put (?:a|an|any number of|up to \w+|that) [^.]{0,40}?lands? [^.]{0,20}?from your hand onto the battlefield/i;

export const cheatsIntoPlay = (dc: DeckCard): boolean => {
  const t = dc.card.oracleText ?? "";
  return CHEATS_INTO_PLAY.test(t) && !LAND_FROM_HAND.test(t);
};

export interface DeckCastability {
  /** Modelled cards, hardest cast first. */
  cards: CardCastability[];
  /** How many cards the model refused to price. */
  refused: number;
  /** The two biases, in the order they are meant to be read. Ships WITH the number, because the
   *  number reads plausible on its own and is not. */
  biases: string;
  /** Cards in the deck that put a nonland permanent onto the battlefield FROM HAND, so its printed
   *  cost is never paid and none of the percentages above apply to it (roadmap I6).
   *
   *  A LIST AND NEVER A NUMBER. How often a deck actually cheats a card into play depends on drawing
   *  the enabler, keeping it alive and holding a target -- a play model this layer does not have,
   *  and neither does the goldfish simulator, which casts no removal and has no opponent. Same
   *  refusal J5 made for the commander tax. */
  cheatsIntoPlay: string[];
}

/** Every nonland card's castability, hardest first.
 *
 *  REPORTED AS AN INTERVAL, and the interval is now the PLAY POLICY rather than two arithmetic
 *  biases. It used to be `mana` (lands only, UNDER-states) against `manaWithRocks` (every rock
 *  already castable, OVER-states), with the truth somewhere between and nothing able to name it.
 *  The simulation names it: the low end holds up two mana, the high end spends everything on
 *  acceleration, and that is where the real error lives. */
export function deckCastability(
  deck: readonly DeckCard[],
  curves: ReadonlyMap<string, CastCurve>,
): DeckCastability {
  const rows = deck
    .filter((dc) => !dc.card.typeLine.toLowerCase().includes("land"))
    .map((dc) => cardCastability(dc, curves));

  // Deduped by name: a decklist that names its commander in both the commander section and the
  // deck body arrives here with two identical entries, and the same card twice in a "hardest casts"
  // list reads as a defect in the analysis rather than in the input.
  const byName = new Map(rows.filter((r) => r.castable !== null).map((r) => [r.name, r]));

  // Deduped by name for the same reason the rows are: a commander named in both sections arrives
  // twice, and a caveat listing one card twice reads as a defect in the analysis.
  const cheats = [...new Set(deck.filter(cheatsIntoPlay).map((dc) => dc.card.name))];

  return {
    cheatsIntoPlay: cheats,
    cards: [...byName.values()]
      .sort((a, b) => (a.castable?.high ?? 1) - (b.castable?.high ?? 1) || b.manaValue - a.manaValue),
    refused: rows.filter((r) => r.castable === null).length,
    biases:
      "A range, not a number, and the range is the PLAY POLICY: the low end holds up two mana before "
      + "casting an accelerant, the high end spends everything on acceleration and is a ceiling no "
      + "real deck plays to. Simulated over 2,000 shuffles with no opponent — nothing is countered, "
      + "killed or taxed — and with no cantrips cast, so a draw-heavy deck reads low. Colours are "
      + "modelled; mulligans are not.",
  };
}
