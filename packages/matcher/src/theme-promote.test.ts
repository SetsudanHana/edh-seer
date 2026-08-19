import { expect, test } from "vitest";
import { promoteSpecificHeadline } from "./theme-promote.js";
import type { ThemeMembership } from "./themes.js";

const m = (tag: string, payoffs: number): ThemeMembership => ({
  tag, surplus: [], payoffs: Array.from({ length: payoffs }, (_, i) => `p${i}`),
  baseline: [], selective: true, members: [],
});

// THE HUMAN TRAP, measured before this rule was written: the highest-support specific sibling is
// `enters:human` in three of the nine dominated decks, so promoting on FREQUENCY alone names a
// Wizard deck "humans entering". `enters:human` has ZERO census presence in every one of them.
test("promotes the sibling the deck CARES about, not the biggest one", () => {
  const ranked = ["enters:creature", "enters:human", "enters:wizard"];
  const freq = new Map([["enters:creature", 21], ["enters:human", 15], ["enters:wizard", 9]]);
  const census = [m("enters:creature", 15), m("enters:human", 0), m("enters:wizard", 2)];
  expect(promoteSpecificHeadline(ranked, freq, census)[0]).toBe("enters:wizard");
});

test("refuses when NO specific sibling closes a loop -- the headline stands", () => {
  const ranked = ["enters:creature", "enters:human", "enters:wall"];
  const freq = new Map([["enters:creature", 13], ["enters:human", 7], ["enters:wall", 10]]);
  const census = [m("enters:creature", 14), m("enters:human", 0), m("enters:wall", 0)];
  expect(promoteSpecificHeadline(ranked, freq, census)[0]).toBe("enters:creature");
});

test("refuses a sibling below the support share, however much the deck cares", () => {
  const ranked = ["enters:creature", "enters:dragon"];
  const freq = new Map([["enters:creature", 30], ["enters:dragon", 4]]); // 13% < 30%
  expect(promoteSpecificHeadline(ranked, freq, [m("enters:creature", 8), m("enters:dragon", 9)])[0])
    .toBe("enters:creature");
});

test("leaves an ALREADY-SPECIFIC headline alone, and never crosses verb or card type", () => {
  const freq = new Map([["enters:dragon", 9], ["enters:wizard", 9], ["attacks:wizard", 9], ["enters:treasure", 9]]);
  const census = [m("enters:wizard", 5), m("attacks:wizard", 5), m("enters:treasure", 5)];
  // already specific
  expect(promoteSpecificHeadline(["enters:dragon", "enters:wizard"], freq, census)[0]).toBe("enters:dragon");
  // a different VERB is not a sibling
  expect(promoteSpecificHeadline(["enters:creature", "attacks:wizard"], new Map([["enters:creature", 10], ["attacks:wizard", 9]]), census)[0])
    .toBe("enters:creature");
  // `treasure` is an ARTIFACT subtype, not a creature one -- the CR assignment, not hierarchy.json's
  // co-occurrence count, which would have made it a kind of creature.
  expect(promoteSpecificHeadline(["enters:creature", "enters:treasure"], new Map([["enters:creature", 10], ["enters:treasure", 9]]), census)[0])
    .toBe("enters:creature");
});

test("an `any` headline can be promoted over by any subtype at all", () => {
  const ranked = ["enters:any", "enters:saga"];
  const freq = new Map([["enters:any", 10], ["enters:saga", 6]]);
  expect(promoteSpecificHeadline(ranked, freq, [m("enters:any", 3), m("enters:saga", 4)])[0]).toBe("enters:saga");
});

test("promotion MOVES the tag to the head and keeps every other tag, in order", () => {
  const ranked = ["enters:creature", "draw:any", "enters:wizard", "dies:creature"];
  const freq = new Map([["enters:creature", 10], ["draw:any", 8], ["enters:wizard", 9], ["dies:creature", 4]]);
  const out = promoteSpecificHeadline(ranked, freq, [m("enters:wizard", 3)]);
  expect(out).toEqual(["enters:wizard", "enters:creature", "draw:any", "dies:creature"]);
});
