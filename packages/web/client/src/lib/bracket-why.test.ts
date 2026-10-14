import { expect, test } from "vitest";
import { infiniteCombos } from "./bracket-why.js";

/** #1194: `cheap` is the REPORT's call (`bracket.cheapCombos`, the matcher's own filter), never a second
 *  computation here. Measured equal on all 71 calibration decks, so reading it changes no output. */
const combos = [
  { cards: ["Dualcaster Mage", "Twinflame"], result: "Infinite creatures" },
  { cards: ["Isochron Scepter", "Dramatic Reversal"], result: "Infinite mana" },
];
const mv = (n: string): number => ({ "Dualcaster Mage": 3, Twinflame: 3, "Isochron Scepter": 2, "Dramatic Reversal": 2 })[n] ?? 0;

test("a combo is cheap when the report's cheapCombos names it, whatever its cost here", () => {
  const cheap = [{ cards: ["Dualcaster Mage", "Twinflame"], result: "Infinite creatures", manaValue: 6 }];
  const listed = infiniteCombos(combos, mv, cheap);
  expect(listed.map((c) => [c.cards[0], c.cheap])).toEqual([["Dualcaster Mage", true], ["Isochron Scepter", false]]);
});

test("a combo the report does not call cheap is not, even when the two cards cost little", () => {
  expect(infiniteCombos(combos, mv, []).every((c) => !c.cheap)).toBe(true);
});

/** A bare two-card loop and the same two cards with an unnamed third piece (#568) are two combos
 *  (Guilty Conscience + Brash Taunter in the corpus). Only the bare one is in `cheapCombos`. */
test("a cheap two-card combo does not make its same-named three-piece twin cheap", async () => {
  const { deckBracket } = await import("@edh-seer/matcher/brackets");
  const pair = { cards: ["Guilty Conscience", "Brash Taunter"], result: "Infinite damage to one opponent" };
  const twin = { ...pair, requires: ["Card That Gives Indestructible"] };
  const cards = [{ name: "Guilty Conscience", manaValue: 1 }, { name: "Brash Taunter", manaValue: 5 }];
  const b = deckBracket(cards as never, [pair, twin] as never);
  expect(b.cheapCombos).toHaveLength(1);
  const listed = infiniteCombos([pair, twin], (n) => cards.find((c) => c.name === n)?.manaValue, b.cheapCombos);
  expect(listed.map((c) => [c.requires ?? [], c.cheap])).toEqual([[[], true], [["Card That Gives Indestructible"], false]]);
});
