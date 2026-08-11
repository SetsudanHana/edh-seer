import { karstenLands, type KarstenInputs } from "@mtg/engine";
import { detectBuildCategories } from "./build.js";
import type { DeckCard } from "./types.js";

/** The mana value at or below which acceleration counts for Karsten's 0.28 bucket. Cheap ramp
 *  shortens the turns the regression is about; a four-mana ramp spell needs the lands you were
 *  trying to count. */
const CHEAP = 2;

const isLand = (dc: DeckCard): boolean => dc.card.typeLine.toLowerCase().includes("land");

/** Karsten's inputs, read off the deck.
 *
 *  THE SPLIT THIS EXISTS FOR: `fast-mana` sits inside the ramp category everywhere else in this
 *  repo, and Karsten needs it out. A Mox is worth a WHOLE land; cheap ramp is worth 0.28 of one.
 *  Counting five Moxen as cheap ramp costs 3.6 lands of recommendation, which the spec calls the
 *  error most implementations make.
 *
 *  Fast mana is identified by the spec's own definition -- a NONLAND card costing 0 that produces
 *  mana -- rather than by the tagger's `fast-mana` effect kind. The definition is about the card's
 *  printed cost, `producedMana` now reaches `Card`, and a definition beats a label when the label
 *  was assigned for a different purpose. */
export function landInputs(
  deck: readonly DeckCard[],
  opts: { commanderNames?: readonly string[] } = {},
): Required<KarstenInputs> {
  const commanders = new Set(opts.commanderNames ?? []);
  const library = deck.filter((dc) => !commanders.has(dc.card.name));
  const nonland = library.filter((dc) => !isLand(dc));

  const avgManaValue = nonland.length > 0
    ? nonland.reduce((sum, dc) => sum + dc.card.manaValue, 0) / nonland.length
    : 0;

  const fast = nonland.filter(
    (dc) => dc.card.manaValue === 0 && (dc.card.producedMana ?? []).length > 0,
  );
  const fastNames = new Set(fast.map((dc) => dc.card.name));

  // Ramp and draw membership come from the same rules every other readout uses, so a rules edit
  // moves this too rather than leaving a second definition behind.
  const members = detectBuildCategories([...library]);
  const accelerants = new Set([
    ...(members.get("ramp") ?? []),
    ...(members.get("draw") ?? []),
    // A cheap nonland that produces mana is a rock, whatever the tagger made of it. `ramp` reaches
    // rocks through the `mana-generation` effect kind, which needs the card to have been TAGGED --
    // so an untagged Sol Ring would leave the regression thinking the deck has no acceleration at
    // all. `producedMana` is printed data and cannot go missing that way.
    ...nonland
      .filter((dc) => dc.card.manaValue <= CHEAP && (dc.card.producedMana ?? []).length > 0)
      .map((dc) => dc.card.name),
  ]);
  const rampPlusDraw = nonland.filter(
    (dc) => accelerants.has(dc.card.name) && dc.card.manaValue <= CHEAP && !fastNames.has(dc.card.name),
  ).length;

  return {
    avgManaValue,
    rampPlusDraw,
    fastMana: fast.length,
    commanders: Math.max(1, commanders.size),
    // Not detected: nothing in this repo reads card layout, so a deck running Bala Ged Recovery
    // reads very slightly land-heavy. Reported as an explicit 0 rather than left to the
    // regression's default, so the omission is visible at the call site.
    mdfcUntapped: 0,
    mdfcTapped: 0,
  };
}

export interface LandRecommendation extends Required<KarstenInputs> {
  /** Lands the deck runs, counting copies. */
  actual: number;
  /** What the regression asks for, rounded -- it returns a fractional land otherwise. */
  target: number;
}

/** Target vs actual land count for a deck.
 *
 *  Tier B: a published regression, not something fitted here, and it reads AVERAGE mana value only.
 *  A bimodal deck and a flat one get the same answer, and there is no colour term at all -- how
 *  many lands is a different question from which ones, which is `manaAudit`'s. */
export function recommendedLands(
  deck: readonly DeckCard[],
  opts: { commanderNames?: readonly string[] } = {},
): LandRecommendation {
  const inputs = landInputs(deck, opts);
  const commanders = new Set(opts.commanderNames ?? []);
  return {
    ...inputs,
    actual: deck.filter((dc) => !commanders.has(dc.card.name) && isLand(dc)).length,
    target: Math.round(karstenLands(inputs)),
  };
}
