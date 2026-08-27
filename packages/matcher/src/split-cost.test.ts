import { expect, test } from "vitest";
import { castableManaCost } from "./split-cost.js";

const split = (manaCost: string, keywords: string[] = []) =>
  ({ manaCost, layout: "split", keywords });

/** THE WITNESS. Priced as one nine-mana four-white-pip spell, it was the sole cause of the precon's
 *  only colour warning and of a "9-drop" row that no player has ever paid. */
test("an Aftermath card is cast from hand at its FRONT half only", () => {
  expect(castableManaCost(split("{2}{W}{W} // {3}{W}{W}", ["Aftermath"]))).toBe("{2}{W}{W}");
});

test("a plain split is castable at its CHEAPER half", () => {
  expect(castableManaCost(split("{4}{R} // {1}{U}"))).toBe("{1}{U}");
  // Front half cheaper: still the front.
  expect(castableManaCost(split("{G} // {5}{W}{W}"))).toBe("{G}");
});

/** FUSE IS THE ONE THIRD OF THE FAMILY THE OLD BEHAVIOUR WAS RIGHT ABOUT — "you may cast one or both
 *  halves from your hand", so the combined cost is a real number rather than a fiction. */
test("a Fuse card keeps its combined cost", () => {
  expect(castableManaCost(split("{1}{W} // {1}{U}", ["Fuse"]))).toBe("{1}{W} // {1}{U}");
});

test("an ordinary card is returned untouched, so every caller can use this unconditionally", () => {
  expect(castableManaCost({ manaCost: "{4}{W}{W}", layout: "normal" })).toBe("{4}{W}{W}");
  expect(castableManaCost({ manaCost: undefined })).toBeUndefined();
  expect(castableManaCost({ manaCost: "" })).toBe("");
});

/** A MODAL DFC ALREADY ARRIVES AS ITS FRONT FACE (`docToCard` takes `faces[0].manaCost` for those
 *  layouts), so nothing here should ever re-split one — and a layout that is not `split` is refused
 *  even if a joined string somehow reaches it. */
test("only the split layout is split", () => {
  expect(castableManaCost({ manaCost: "{2}{B} // {1}{G}", layout: "modal_dfc" })).toBe("{2}{B} // {1}{G}");
  expect(castableManaCost({ manaCost: "{2}{B} // {1}{G}", layout: "transform" })).toBe("{2}{B} // {1}{G}");
});

test("a malformed joined cost falls back to the whole string rather than to a free spell", () => {
  expect(castableManaCost(split("{2}{W} // "))).toBe("{2}{W} // ");
});

/** THE GATE THAT ACTUALLY BOUND, and the reason a cost fix alone barely moved the number.
 *
 *  `simulate` skips a card before asking `payable` unless the board's total mana reaches the card's
 *  MANA VALUE. For a non-Fuse split that value is the sum of both halves (CR 202.3b), so
 *  `Dusk // Dawn` needed nine mana on board to be considered for a `{2}{W}{W}` cost. Measured: with
 *  `cost` corrected but this gate still on `manaValue`, its turn-9 castability moved 13% -> 16.5%;
 *  with both, it reads what a four-mana spell reads. */
