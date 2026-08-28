import type { Card, Combo } from "@edh-seer/engine";

/** WHAT COUNTS AS A CHEAP COMBO, as a total mana value across both pieces.
 *
 *  CHOSEN FROM THE DISTRIBUTION, not from taste, and the sweep is why six rather than a rounder
 *  number: over the 71 calibration decks the bands read 33/28/10 at <=4, **33/26/12 at BOTH <=5 and
 *  <=6**, 33/20/18 at <=7 and 33/19/19 at <=8. Five and six agreeing exactly is a plateau, and six
 *  is its upper edge — the most generous reading of "cheap" that does not start reclassifying decks.
 *
 *  DOCTRINE, with the caveat every threshold in this repo carries: the 71 decks are one owner's
 *  collection and not a meta. What the plateau establishes is that the answer is INSENSITIVE across
 *  the range a reader would argue about, which is the only thing a sweep can establish. */
export const CHEAP_COMBO_MV = 6;

/** The Game Changer ceiling bracket 3 allows. WotC's number, not ours. */
const BRACKET_3_GAME_CHANGERS = 3;

/** Which combos this reads as INFINITE. Commander Spellbook states the loop in its RESULT text and
 *  nowhere else — `ComboDoc` is `{cards, result}` and carries no flag — so the word is the fact.
 *
 *  MEASURED before it was trusted: 103,343 of the 106,605 combos in the corpus (97%) say it, and the
 *  remainder are genuinely finite ("Lock, Prevent all damage that would be dealt to you"). Per deck
 *  the split is what matters and it is real: of the 29 calibration decks holding a combo, 27 hold an
 *  infinite one, and `codie` and `orzhov-spellslinger` hold combos with none. */
const INFINITE = /\binfinite\b/i;

export interface BracketCombo {
  cards: string[];
  result: string;
  /** Total mana value of every piece, summed off the deck's own cards. */
  manaValue: number;
}

export interface DeckBracket {
  /** THREE BANDS AND NOT FIVE, and the missing precision is a ceiling rather than an omission:
   *  1 vs 2 is about how the deck was BUILT (a precon, an unmodified theme deck) and 4 vs 5 is a
   *  META judgement (whether it is cEDH). Neither is a checkable list, and the two facts WotC does
   *  publish as lists — Game Changers and combos — cannot separate them. */
  band: "1-2" | "3" | "4-5";
  /** Cards on WotC's published Game Changer list, by name. 53 exist; the corpus carries the flag. */
  gameChangers: string[];
  /** Combos in the deck whose result states an infinite loop. */
  infiniteCombos: number;
  /** The two-card infinite combos at or under `CHEAP_COMBO_MV`, which is what bracket 3 forbids. */
  cheapCombos: BracketCombo[];
  /** Why it is not in a lower band, in the reader's words. Empty at 1-2. */
  reasons: string[];
}

/** WHICH COMMANDER BRACKET THE DECK'S CONTENTS ALLOW (roadmap L3, WotC's official 1-5 tiers).
 *
 *  DEFINITIONAL, NOT EMPIRICAL, and that is the whole reason this item was worth code while the
 *  other eleven community sources were not: brackets are a published RULE about what a deck may
 *  contain, so there is nothing here to fit, tune or refute. A lookup either matches the list or it
 *  does not.
 *
 *  A JOIN OVER FACTS THE ENGINE ALREADY HAS. `gameChanger` has been on every corpus card since the
 *  card-graph work and `ComboIndex` has found the combos since long before that; what was missing
 *  was only the arithmetic between them. Nothing here forms an edge, reads a rating or moves a
 *  score, which is the acceptance test.
 *
 *  IT DESCRIBES, IT DOES NOT JUDGE. A deck in 4-5 is not a worse deck than one in 1-2 — it is a
 *  deck for a different table — so every renderer of this owes the reader that framing rather than
 *  a grade. */
export function deckBracket(cards: Card[], combos: Combo[]): DeckBracket {
  const manaValue = new Map(cards.map((c) => [c.name, c.manaValue ?? 0]));
  const gameChangers = [...new Set(cards.filter((c) => c.gameChanger === true).map((c) => c.name))].sort();

  const infinite = combos.filter((c) => INFINITE.test(c.result ?? ""));
  // A combo's cost is summed off the DECK's own cards, because that is where mana value lives — a
  // `Combo` is two names and a sentence. Every combo here is contained in the deck by construction
  // (`combosContainedIn`), so a missing lookup can only be a resolution failure, and 0 is the
  // lenient answer: it reads the combo as CHEAPER, which keeps the deck in the higher band rather
  // than flattering it into a lower one.
  const cheapCombos: BracketCombo[] = infinite
    .filter((c) => c.cards.length <= 2)
    .map((c) => ({
      cards: c.cards,
      result: c.result,
      manaValue: c.cards.reduce((total, n) => total + (manaValue.get(n) ?? 0), 0),
    }))
    .filter((c) => c.manaValue <= CHEAP_COMBO_MV)
    .sort((a, b) => a.manaValue - b.manaValue || a.cards.join().localeCompare(b.cards.join()));

  const reasons: string[] = [];
  if (gameChangers.length > 0) {
    reasons.push(
      `${gameChangers.length} Game Changer${gameChangers.length === 1 ? "" : "s"}: ${gameChangers.join(", ")}`,
    );
  }
  if (infinite.length > 0) {
    reasons.push(`${infinite.length} infinite combo${infinite.length === 1 ? "" : "s"}`);
  }
  for (const c of cheapCombos) {
    reasons.push(`${c.cards.join(" + ")} is a two-card infinite combo costing ${c.manaValue} total`);
  }

  const band: DeckBracket["band"] =
    gameChangers.length === 0 && infinite.length === 0 ? "1-2"
      : gameChangers.length <= BRACKET_3_GAME_CHANGERS && cheapCombos.length === 0 ? "3"
        : "4-5";

  return { band, gameChangers, infiniteCombos: infinite.length, cheapCombos, reasons: band === "1-2" ? [] : reasons };
}
