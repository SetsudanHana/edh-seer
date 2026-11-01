import { expect, test } from "vitest";
import { joinMultiWordSubtypes, SUBTYPE_TYPES } from "./subtypes.js";

// "TIME LORD" IS ONE SUBTYPE, NOT TWO. Every type-line splitter in this repo split the subtype part
// on whitespace, so "Legendary Creature — Time Lord Doctor" produced ["time","lord","doctor"] — two
// subtypes that do not exist and one that does. It reached the product: `it-is-time` themed
// `enters:time`. Exactly one multi-word subtype exists in all of Magic.
test("joinMultiWordSubtypes rejoins a multi-word subtype and leaves ordinary ones alone", () => {
  expect(joinMultiWordSubtypes(["time", "lord", "doctor"])).toEqual(["time lord", "doctor"]);
  expect(joinMultiWordSubtypes(["human", "wizard"])).toEqual(["human", "wizard"]);
  expect(joinMultiWordSubtypes(["time", "lord"])).toEqual(["time lord"]);
  expect(joinMultiWordSubtypes([])).toEqual([]);
  // A trailing fragment that only PARTLY matches is left as printed rather than invented into one.
  expect(joinMultiWordSubtypes(["doctor", "time"])).toEqual(["doctor", "time"]);
});

test("exactly one multi-word subtype exists, so the join is bounded", () => {
  expect(Object.keys(SUBTYPE_TYPES).filter((s) => s.includes(" "))).toEqual(["time lord"]);
});

// MTGJSON listed "Missing" as a creature type until the 2026-11 regeneration (#1349 part 3) dropped it; no printed card ever had it and it is an English word (the generator keeps such words out of the free-text sets).
test("'missing' is no free-text subtype: 'cards missing from your graveyard' names no creature type", async () => {
  const { CREATURE_SUBTYPES, SUBTYPES } = await import("./subtypes.js");
  const { parseSubject } = await import("./subject.js");
  expect(SUBTYPES.has("missing")).toBe(false);
  expect(CREATURE_SUBTYPES).not.toContain("missing");
  expect(parseSubject("cards missing from your graveyard").subtype).toBeUndefined();
});
