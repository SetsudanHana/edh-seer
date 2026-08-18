import { expect, test } from "vitest";
import { foldThemeTag, foldFamilies, makeFold, NO_FOLD, DOMINANT_SHARE } from "./theme-fold.js";
import type { Hierarchy } from "./types.js";

const H: Hierarchy = {
  saproling: ["creature"], citizen: ["creature"], wizard: ["creature"], goblin: ["creature"],
  forest: ["land"], mountain: ["land"], treasure: ["artifact"], aura: ["enchantment"],
  // a subtype recorded on two card types resolves deterministically by TYPE_PRIORITY
  shapeshifter: ["artifact", "creature"],
};

test("a subtype folds to its card type; a card type and :any stay put", () => {
  expect(foldThemeTag("create-token:saproling", H)).toBe("create-token:creature");
  expect(foldThemeTag("enters:forest", H)).toBe("enters:land");
  expect(foldThemeTag("create-token:treasure", H)).toBe("create-token:artifact");
  expect(foldThemeTag("enters:creature", H)).toBe("enters:creature");
  expect(foldThemeTag("enters:any", H)).toBe("enters:any");
});

test("a multi-type subtype resolves by priority, not by hierarchy.json ordering", () => {
  expect(foldThemeTag("enters:shapeshifter", H)).toBe("enters:creature");
});

// THE REGRESSION THIS MUST NOT REINTRODUCE (38e5248): five tribal decks stopped naming their tribe
// when the subject was dropped from the label.
test("tribe and static never fold", () => {
  expect(foldThemeTag("tribe:wizard", H)).toBe("tribe:wizard");
  expect(foldThemeTag("tribe-nontoken:goblin", H)).toBe("tribe-nontoken:goblin");
  expect(foldThemeTag("static:pump", H)).toBe("static:pump");
  expect(foldThemeTag("counter:+1/+1", H)).toBe("counter:+1/+1");
});

test("an unknown value and a negation are left alone", () => {
  expect(foldThemeTag("cast:-creature", H)).toBe("cast:-creature");
  expect(foldThemeTag("enters:spacecraft", H)).toBe("enters:spacecraft");
});

test("NO_FOLD is the identity, so an opt-out caller behaves exactly as before", () => {
  expect(NO_FOLD("create-token:saproling")).toBe("create-token:saproling");
});

test("a spread family is named by its own key; a dominated one keeps its child's name", () => {
  const spread = new Map([
    ["create-token:saproling", 3], ["create-token:citizen", 2], ["create-token:goblin", 2],
  ]);
  const dominated = new Map([["enters:wizard", 25], ["enters:goblin", 3]]);
  const f = makeFold(H);
  expect(foldFamilies(spread, f).get("create-token:creature")).toMatchObject({
    total: 7, representative: "create-token:creature",
  });
  expect(foldFamilies(dominated, f).get("enters:creature")).toMatchObject({
    total: 28, representative: "enters:wizard",
  });
});

test("the dominance test is a SHARE, so a small family counts the same as a large one", () => {
  const f = makeFold(H);
  const small = new Map([["enters:wizard", 3], ["enters:goblin", 2]]);   // 0.6 >= 0.5
  const even = new Map([["enters:wizard", 2], ["enters:goblin", 2], ["enters:citizen", 1]]); // 0.4
  expect(DOMINANT_SHARE).toBe(0.5);
  expect(foldFamilies(small, f).get("enters:creature")!.representative).toBe("enters:wizard");
  expect(foldFamilies(even, f).get("enters:creature")!.representative).toBe("enters:creature");
});
