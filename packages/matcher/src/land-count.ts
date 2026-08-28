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
  // AN MDFC IS A SPELL YOU MAY PLAY AS A LAND, and Karsten's convention is to count it as a spell
  // and then discount the land requirement by its own coefficient. `isLand` is a type-line test, so
  // "Instant // Land" reads as a land everywhere else in this repo -- correct for the graph and the
  // matcher, wrong here, where counting it as a full land AND applying the coefficient would pay
  // for the same card twice. Local to the regression; no other reader's notion of a land moves.
  const nonland = library.filter((dc) => !isLand(dc) || mdfcLandBack(dc) !== null);

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
  const mdfcNames = new Set(
    library.filter((_, i) => mdfc[i] !== null).map((dc) => dc.card.name),
  );

  const rampPlusDraw = nonland.filter(
    (dc) => accelerants.has(dc.card.name) && dc.card.manaValue <= CHEAP
      && !fastNames.has(dc.card.name)
      // An MDFC is priced by its own coefficient below; counting Silundi Vision as cheap ramp as
      // well would pay for the same card twice, which is the exact error the fast-mana split exists
      // to avoid. It reaches the accelerant net at all only because `producedMana` carries the BACK
      // face's colour.
      && !mdfcNames.has(dc.card.name),
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
    // MDFCs are OUT of the land count for the same reason they are in `nonland` above: the target
    // they are measured against already prices them, at 0.74 of a land untapped and 0.38 tapped.
    actual: deck.filter(
      (dc) => !commanders.has(dc.card.name) && isLand(dc) && mdfcLandBack(dc) === null,
    ).length,
    target: Math.round(karstenLands(inputs)),
  };
}
