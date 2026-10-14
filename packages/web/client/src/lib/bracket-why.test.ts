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
