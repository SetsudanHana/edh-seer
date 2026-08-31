import { karstenLands, type KarstenInputs } from "@edh-seer/engine";
import { detectBuildCategories } from "./build.js";
import type { DeckCard } from "./types.js";

/** The mana value at or below which acceleration counts for Karsten's 0.28 bucket. Cheap ramp
 *  shortens the turns the regression is about; a four-mana ramp spell needs the lands you were
 *  trying to count. */
const CHEAP = 2;

const isLand = (dc: DeckCard): boolean => dc.card.typeLine.toLowerCase().includes("land");

/** A modal double-faced card with a LAND back, and whether that land enters untapped -- Karsten
 *  prices the two differently (0.74 of a land against 0.38), because a tapped one costs you the
 *  turn you play it.
 *
 *  `layout` IS THE GATE, and measuring is what forced it: the type-line test alone catches Treasure
 *  Map // Treasure Cove, Dowsing Dagger // Lost Vale, Ojer Axonil and Growing Rites of Itlimoc,
 *  which are TRANSFORM cards -- their land back is reached by transforming a permanent already in
 *  play and you can never play them as a land. That is the same distinction `FRONT_FACE_ONLY` draws
 *  in derive. Five of the fifteen candidates in the 71 decks are that shape.
 *
 *  UNTAPPED covers two printed shapes: a back with no tapped clause at all, and the Zendikar Rising
 *  cycle's "As this land enters, you may pay 3 life. If you don't, it enters tapped" -- a real
 *  choice, and the cycle Karsten's untapped coefficient was fitted on. */
const mdfcLandBack = (dc: DeckCard): "untapped" | "tapped" | null => {
  if (dc.card.layout !== "modal_dfc") return null;
  const halves = dc.card.typeLine.split("//").map((s) => s.trim());
  if (halves.length !== 2 || /\bland\b/i.test(halves[0]) || !/\bland\b/i.test(halves[1])) return null;
  const back = (dc.card.oracleText ?? "").split("\n//\n")[1] ?? "";
  if (/you may pay/i.test(back)) return "untapped";
  return /enters tapped/i.test(back) ? "tapped" : "untapped";
};

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
  // AN MDFC IS A LAND (owner ruling 2026-08-31), so it is NOT in the spell pool. Karsten's own
  // convention is the opposite -- count it as a spell and discount the requirement by 0.74/0.38 --
  // and `recommendedLands` below records why this repo departs from it. What matters here is that
  // the two halves move together: a card counted as a land must also leave the pool that sets
  // `avgManaValue`, the regression's dominant term, or its mana value pushes the target back up by
  // part of what the count just gained. That is the same double count this change exists to remove,
  // pointing the other way.
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
  const mdfc = library.map(mdfcLandBack);

  // An MDFC cannot reach this filter at all now -- `nonland` excludes every land, and an MDFC is
  // one. It used to need an explicit `!mdfcNames.has(...)` guard here, because it sat in the spell
  // pool and `producedMana` carries the BACK face's colour, so Silundi Vision looked like cheap
  // ramp and was paid for twice. Counting it as a land removes the guard's reason to exist rather
  // than the guard's effect: a land is not ramp under either convention.
  const rampPlusDraw = nonland.filter(
    (dc) => accelerants.has(dc.card.name) && dc.card.manaValue <= CHEAP
      && !fastNames.has(dc.card.name),
  ).length;

  return {
    avgManaValue,
    rampPlusDraw,
    fastMana: fast.length,
    commanders: Math.max(1, commanders.size),
    mdfcUntapped: mdfc.filter((m) => m === "untapped").length,
    mdfcTapped: mdfc.filter((m) => m === "tapped").length,
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
    // MDFCs ARE IN THE LAND COUNT, which makes this the same type-line test `build.ts` uses --
    // deliberately, because the two disagreeing is the defect this replaced. Before 2026-08-31
    // `actual` excluded them while `build.ts`'s count did not, and BOTH were compared against a
    // target already discounted for them, so the build row read a phantom surplus (enchanting-rani:
    // 38 against 33, where the honest pair is 38 against 36).
    actual: deck.filter((dc) => !commanders.has(dc.card.name) && isLand(dc)).length,
    // THE COEFFICIENTS ARE DELIBERATELY OFF, AND THIS IS A DEPARTURE FROM THE PUBLISHED REGRESSION.
    // Karsten counts a land-back MDFC as a spell and discounts the land requirement by 0.74
    // (untapped) or 0.38 (tapped). Owner's ruling 2026-08-31: you play these as lands primarily and
    // cast the front half only once you have enough real lands, so they belong in the count at full
    // weight. Measured across the 55 calibration decks that run one, mean delta against target:
    // **+1.56 as it was (discount applied, card still counted) · -1.40 all-Karsten · -0.36 here**,
    // with 12 decks outside the +-3 band against 17 and 16, and only this arm's misses symmetric
    // (6 high / 6 low). All-Karsten reads real decks 1.4 lands SHORT, which is the signature of
    // players already treating these as lands and running fewer real ones.
    // COST, NAMED: 0.74-vs-0.38 was the model's way of saying a tapped land-back is worth half an
    // untapped one, and counting both at 1.0 throws that away. `mdfcUntapped`/`mdfcTapped` are still
    // reported above so a future refinement has its input; inventing a third coefficient to split
    // the difference would be fitting to 55 decks.
    target: Math.round(karstenLands({ ...inputs, mdfcUntapped: 0, mdfcTapped: 0 })),
  };
}
