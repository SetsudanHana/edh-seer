import { expect, test } from "vitest";
import type { Card, Combo } from "@edh-seer/engine";
import { CHEAP_COMBO_MV, deckBracket } from "./brackets.js";

const card = (name: string, manaValue: number, gameChanger?: boolean): Card => ({
  name, typeLine: "Artifact", oracleText: "", keywords: [], colors: [], manaValue,
  ...(gameChanger !== undefined ? { gameChanger } : {}),
} as Card);

const combo = (cards: string[], result: string): Combo => ({ cards, result });

const INFINITE = "Infinite untap, Infinite mana";
const FINITE = "Lock, Prevent all damage that would be dealt to you";

test("no Game Changers and no infinite combo is brackets 1-2", () => {
  const b = deckBracket([card("Bear", 2), card("Rock", 2)], []);
  expect(b.band).toBe("1-2");
  expect(b.reasons).toEqual([]);
});

// A FINITE COMBO IS NOT AN INFINITE ONE, and the word is the only fact `ComboDoc` carries — it is
// `{cards, result}` with no flag. Measured: 103,343 of 106,605 corpus combos say "Infinite", and
// two of the 71 calibration decks (codie, orzhov-spellslinger) hold combos with none.
test("a finite combo leaves the deck in 1-2; an infinite one does not", () => {
  const cards = [card("A", 2), card("B", 2)];
  expect(deckBracket(cards, [combo(["A", "B"], FINITE)]).band).toBe("1-2");
  expect(deckBracket(cards, [combo(["A", "B"], INFINITE)]).band).not.toBe("1-2");
});

test("a single Game Changer leaves 1-2, and up to three is still bracket 3", () => {
  const three = [card("A", 2, true), card("B", 2, true), card("C", 2, true), card("D", 2)];
  const b = deckBracket(three, []);
  expect(b.band).toBe("3");
  expect(b.gameChangers).toEqual(["A", "B", "C"]);
  // The fourth is what WotC's own cap forbids.
  expect(deckBracket([...three, card("E", 2, true)], []).band).toBe("4-5");
});

// BRACKET 3'S OWN LINE: an infinite combo is allowed, a CHEAP TWO-CARD one is not.
test("a cheap two-card infinite combo is what separates bracket 3 from 4-5", () => {
  const cheap = [card("Isochron Scepter", 2), card("Dramatic Reversal", 2)];
  const b = deckBracket(cheap, [combo(["Isochron Scepter", "Dramatic Reversal"], INFINITE)]);
  expect(b.band).toBe("4-5");
  expect(b.cheapCombos).toEqual([
    { cards: ["Isochron Scepter", "Dramatic Reversal"], result: INFINITE, manaValue: 4 },
  ]);

  // The SAME two-card infinite combo, one mana over the line, is a bracket 3 deck.
  const dear = [card("Isochron Scepter", 2), card("Dramatic Reversal", CHEAP_COMBO_MV - 1)];
  const over = deckBracket(dear, [combo(["Isochron Scepter", "Dramatic Reversal"], INFINITE)]);
  expect(over.band).toBe("3");
  expect(over.cheapCombos).toEqual([]);
  expect(over.infiniteCombos).toBe(1);

  // …and a THREE-card infinite combo at the same total cost is bracket 3 too: the rule is about
  // two-card combos, so piece COUNT is load-bearing beside piece cost.
  const wide = [card("A", 1), card("B", 1), card("C", 1)];
  expect(deckBracket(wide, [combo(["A", "B", "C"], INFINITE)]).band).toBe("3");
});

test("every reason names the fact that produced it, and 1-2 states none", () => {
  const b = deckBracket(
    [card("Rhystic Study", 3, true), card("Isochron Scepter", 2), card("Dramatic Reversal", 2)],
    [combo(["Isochron Scepter", "Dramatic Reversal"], INFINITE)],
  );
  expect(b.reasons).toEqual([
    "1 Game Changer: Rhystic Study",
    "1 infinite combo",
    "Isochron Scepter + Dramatic Reversal is a two-card infinite combo costing 4 total",
  ]);
});

// A missing mana value reads the combo as CHEAPER, which keeps the deck in the HIGHER band. A
// resolution failure must not flatter a deck into a lower bracket than its contents allow.
test("an unresolved piece is priced at zero, which is the strict direction", () => {
  const b = deckBracket([card("A", 2)], [combo(["A", "Not In Deck"], INFINITE)]);
  expect(b.cheapCombos[0]?.manaValue).toBe(2);
  expect(b.band).toBe("4-5");
});
