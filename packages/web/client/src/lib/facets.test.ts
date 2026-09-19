import { expect, test } from "vitest";
import { coloursFit, eventsFromParams, eventsToParams, intersect, rateLabel } from "./facets.js";

/** THE SEARCH IS ASKED IN EVENTS (spec 2026-09-19): repeated params because a key can carry a
 *  comma, everything ANDs, and identity is fits-in on Cards and exact on Commanders. */

/** A JOINED LIST WOULD HAVE BEEN UNSPLITTABLE. 274 of the 1,187 corpus keys contain a comma; this
 *  pins the param shape against a "tidy it into one param" change. */
test("a key carrying a comma survives the round trip", () => {
  const comma = "fills|creature,enchantment|-|-";
  const params = eventsToParams({ produce: [comma, "enters|land|-|-"], consume: [], colours: ["R", "G"] }, new URLSearchParams());
  expect(params.getAll("produce")).toEqual([comma, "enters|land|-|-"]);
  expect(eventsFromParams(params)).toEqual({ produce: [comma, "enters|land|-|-"], consume: [], colours: ["R", "G"] });
});

test("a static key carrying colons and commas survives too", () => {
  const key = "applies:cost-reduction|creature,artifact|cleric,rogue|-";
  const params = eventsToParams({ produce: [], consume: [key], colours: [] }, new URLSearchParams());
  expect(eventsFromParams(params).consume).toEqual([key]);
});

test("params the reader did not set are left alone, and an emptied group is removed", () => {
  const before = new URLSearchParams("q=samut&produce=a&produce=b&colors=RG");
  const after = eventsToParams({ produce: [], consume: ["c"], colours: [] }, before);
  expect(after.get("q")).toBe("samut");
  expect(after.getAll("produce")).toEqual([]);
  expect(after.getAll("consume")).toEqual(["c"]);
  expect(after.get("colors")).toBeNull();
});

/** `does` AND `theme` ARE NOT READ ANY MORE. An old shared link lands on an unfiltered page rather
 *  than on an answer to a question the vocabulary no longer has. */
test("the retired params are ignored, not honoured", () => {
  const q = eventsFromParams(new URLSearchParams("does=draw-card&theme=tokens&produce=a"));
  expect(q).toEqual({ produce: ["a"], consume: [], colours: [] });
});

/** THE REVERSAL (owner 2026-09-19): a card list is read while building a deck, a commander list to
 *  choose a commander. The 2026-09-08 exact-on-both ruling survives on Commanders. */
test("colours: fits-in on Cards, exact on Commanders", () => {
  expect(coloursFit("R", ["R", "G"], "cards")).toBe(true);
  expect(coloursFit("RG", ["R", "G"], "cards")).toBe(true);
  expect(coloursFit("", ["R", "G"], "cards")).toBe(true);
  expect(coloursFit("RU", ["R", "G"], "cards")).toBe(false);
  expect(coloursFit("R", ["R", "G"], "commanders")).toBe(false);
  expect(coloursFit("RG", ["R", "G"], "commanders")).toBe(true);
  expect(coloursFit("R", [], "cards")).toBe(true);
});

test("C is colourless only, on both pages", () => {
  expect(coloursFit("", ["C"], "cards")).toBe(true);
  expect(coloursFit("", ["C"], "commanders")).toBe(true);
  expect(coloursFit("R", ["C"], "cards")).toBe(false);
});

test("intersect keeps only the ids in every list", () => {
  expect([...intersect([[1, 2, 3], [2, 3, 4], [3, 2]])].sort()).toEqual([2, 3]);
  expect([...intersect([[1, 2], []])]).toEqual([]);
  expect([...intersect([[5, 6]])].sort()).toEqual([5, 6]);
  expect([...intersect([])]).toEqual([]);
});

/** THE RATE LABELS STAY (`HighSynergyCards` prints them); only the rate ORDER went with the chip
 *  that named its family. */
test("a rate still prints both ends", () => {
  expect(rateLabel([1, 1, 1, 1], "cards")).toBe("1 card / 1 mana");
  expect(rateLabel([0, 3, 9, 3], "cards")).toBe("0–9 cards / 3 mana");
  expect(rateLabel([1, 8, 1, 4, 1], "cards")).toBe("1 card / 8 mana, then 1 / 4, from next turn");
});
