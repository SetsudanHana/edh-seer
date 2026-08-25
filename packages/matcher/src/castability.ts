import { pAtLeast, seen } from "@mtg/engine";
import { COLORS, isManaSource, pipsByColor, type Color } from "./mana-audit.js";
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
  /** P(at least `manaValue` lands by `turn`). Null when the cost is refused.
   *
   *  The LOWER bound of the pair: no ramp of any kind counts. */
  mana: number | null;
  /** The UPPER bound: lands plus every nonland permanent mana source cheap enough to have been cast
   *  first (`manaValue < turn`). Null exactly when `mana` is.
   *
   *  OPTIMISTIC BY CONSTRUCTION, and it must never become the headline: the rock itself needs lands
   *  to cast, so the two are positively correlated, and it also ignores summoning sickness on a
   *  dork. Read the pair as an interval containing the truth -- which is the honest shape, since the
   *  exact answer needs a play policy (which land did you play, did you cast the rock or hold
   *  removal) and this layer has none. */
  manaWithRocks: number | null;
  /** One row per coloured pip requirement, each its own probability. NEVER multiplied into `mana`
   *  or into each other -- see `deckCastability`. */
  colors: { color: Color; pips: number; p: number }[];
  /** Present only when `mana` is null: why the model will not price this card. */
  refused?: string;
}

/** Tier 1 castability for one card: can you have the mana, and can you have the colours.
 *
 *  TWO AXES, REPORTED SEPARATELY AND NEVER MULTIPLIED. The product is the tempting single number
 *  and it is wrong: both axes are driven by the same lands, so the correlation is positive and
 *  `P(mana) x P(colour)` under-estimates. It also destroys the diagnosis -- "mana yes, colour no"
 *  is a different deck problem from "colour yes, mana no", and the product hides which you have. */
export function cardCastability(
  card: DeckCard,
  deck: readonly DeckCard[],
  opts: { commanderNames?: readonly string[] } = {},
): CardCastability {
  const commanders = new Set(opts.commanderNames ?? []);
  const library = deck.filter((dc) => !commanders.has(dc.card.name));
  const lands = library.filter((dc) => dc.card.typeLine.toLowerCase().includes("land")).length;
  const turn = Math.max(1, Math.round(card.card.manaValue));

  const refusal = REFUSALS.find((r) => r.test(card));
  if (refusal) {
    return {
      name: card.card.name, manaValue: card.card.manaValue, turn,
      mana: null, manaWithRocks: null, colors: [], refused: refusal.reason,
    };
  }

  const pips = pipsByColor(card.card.manaCost);
  const colors = COLORS.filter((c) => (pips[c] ?? 0) > 0).map((color) => {
    const need = pips[color]!;
    const sources = library.filter(
      (dc) => isManaSource(dc) && (dc.card.producedMana ?? []).includes(color),
    ).length;
    return { color, pips: need, p: pAtLeast(need, sources, seen(turn), library.length) };
  });

  // A rock counts only for turns after its own -- a Signet cast on turn 2 is mana from turn 3.
  const rocks = library.filter(
    (dc) => !dc.card.typeLine.toLowerCase().includes("land")
      && isManaSource(dc)
      && (dc.card.producedMana ?? []).length > 0
      && dc.card.manaValue < turn,
  ).length;

  return {
    name: card.card.name,
    manaValue: card.card.manaValue,
    turn,
    mana: pAtLeast(card.card.manaValue, lands, seen(turn), library.length),
    manaWithRocks: pAtLeast(card.card.manaValue, lands + rocks, seen(turn), library.length),
    colors,
  };
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
 *  REPORTED AS AN INTERVAL, because the two biases used to be folded into one number that read
 *  plausible and was not: `mana` counts lands only and so UNDER-states (a Signet is not a land),
 *  `manaWithRocks` counts every rock already castable and so OVER-states (the rock needs lands
 *  too). The truth is between them and nothing here can name it -- that needs a play policy (which
 *  land did you play on turn 2, did you cast the rock or hold removal), which is where all the real
 *  error lives and which the spec's Tier 3 never mentions.
 *
 *  Still unmodelled in BOTH bounds, so they push the pair up together rather than widening it:
 *  tapped lands and colour coupling. */
export function deckCastability(
  deck: readonly DeckCard[],
  opts: { commanderNames?: readonly string[] } = {},
): DeckCastability {
  const rows = deck
    .filter((dc) => !dc.card.typeLine.toLowerCase().includes("land"))
    .map((dc) => cardCastability(dc, deck, opts));

  // Deduped by name: a decklist that names its commander in both the commander section and the
  // deck body arrives here with two identical entries, and the same card twice in a "hardest casts"
  // list reads as a defect in the analysis rather than in the input.
  const byName = new Map(rows.filter((r) => r.mana !== null).map((r) => [r.name, r]));

  // Deduped by name for the same reason the rows are: a commander named in both sections arrives
  // twice, and a caveat listing one card twice reads as a defect in the analysis.
  const cheats = [...new Set(deck.filter(cheatsIntoPlay).map((dc) => dc.card.name))];

  return {
    cheatsIntoPlay: cheats,
    cards: [...byName.values()]
      .sort((a, b) => (a.mana ?? 1) - (b.mana ?? 1) || b.manaValue - a.manaValue),
    refused: rows.filter((r) => r.mana === null).length,
    biases:
      "A range, not a number: the low figure counts lands only, the high one adds every rock cheap "
      + "enough to be down already — and a rock needs lands too, so the truth sits between them. "
      + "Both ignore tapped lands and colour coupling, so both read high. For a deck that ramps with "
      + "LAND-FETCH spells the range reads LOW instead and can miss the truth entirely: the high "
      + "figure counts only permanents that produce mana, so Farseek and Cultivate are invisible to "
      + "it.",
  };
}
