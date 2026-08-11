import { pAtLeast, seen } from "@mtg/engine";
import { COLORS, pipsByColor, type Color } from "./mana-audit.js";
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
    test: (dc) => /without paying its mana cost/i.test(dc.card.oracleText ?? ""),
    reason: "alternative cost — the card can be cast for free",
  },
];

export interface CardCastability {
  name: string;
  manaValue: number;
  /** The turn this is priced at: the card's own mana value, the same deadline rule the mana audit
   *  uses. You want to cast a 3-drop on turn 3. */
  turn: number;
  /** P(at least `manaValue` lands by `turn`). Null when the cost is refused. */
  mana: number | null;
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
    return { name: card.card.name, manaValue: card.card.manaValue, turn, mana: null, colors: [], refused: refusal.reason };
  }

  const pips = pipsByColor(card.card.manaCost);
  const colors = COLORS.filter((c) => (pips[c] ?? 0) > 0).map((color) => {
    const need = pips[color]!;
    const sources = library.filter((dc) => (dc.card.producedMana ?? []).includes(color)).length;
    return { color, pips: need, p: pAtLeast(need, sources, seen(turn), library.length) };
  });

  return {
    name: card.card.name,
    manaValue: card.card.manaValue,
    turn,
    mana: pAtLeast(card.card.manaValue, lands, seen(turn), library.length),
    colors,
  };
}

export interface DeckCastability {
  /** Modelled cards, hardest cast first. */
  cards: CardCastability[];
  /** How many cards the model refused to price. */
  refused: number;
  /** The two biases, in the order they are meant to be read. Ships WITH the number, because the
   *  number reads plausible on its own and is not. */
  biases: string;
}

/** Every nonland card's castability, hardest first.
 *
 *  WRONG IN TWO DIRECTIONS AT ONCE, which is why the biases travel with the output:
 *  - it ignores ramp, so it UNDER-estimates -- a Signet is not a land here;
 *  - it ignores tapped lands and colour coupling, so it OVER-estimates.
 *  They partly cancel, which is the trap: the number reads plausible and is not. Anything better
 *  needs a play policy (which land did you play on turn 2, did you cast the rock or hold removal),
 *  and that is a heuristic where all the real error lives -- the spec frames Tier 3 as a matching
 *  problem and never mentions it. */
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

  return {
    cards: [...byName.values()]
      .sort((a, b) => (a.mana ?? 1) - (b.mana ?? 1) || b.manaValue - a.manaValue),
    refused: rows.filter((r) => r.mana === null).length,
    biases:
      "Ignores ramp, so it under-states; ignores tapped lands and colour coupling, so it over-states. "
      + "The two partly cancel, which is exactly why neither is safe to drop.",
  };
}
