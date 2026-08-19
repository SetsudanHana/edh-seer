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
  // Not a subtype in any card type's list, so neither the authoritative map nor the fixture
  // hierarchy can place it. (`spacecraft` used to serve here and no longer can -- it IS an artifact
  // subtype, and the authoritative map now says so regardless of what the fixture holds.)
  expect(foldThemeTag("enters:notatype", H)).toBe("enters:notatype");
});

// ASK THE ASSIGNMENT, NOT THE CO-OCCURRENCE COUNT (owner's observation, 2026-08-19). `hierarchy.json`
// is scraped off printed type lines, so `treasure` reaches `creature` through artifact creatures and
// `forest` through Dryad Arbor -- and TYPE_PRIORITY puts creature first, so a Treasure deck's
// `enters:treasure` was counted inside the CREATURE family.
test("the authoritative map beats the co-occurrence hierarchy where they disagree", () => {
  const misleading = { treasure: ["artifact", "creature"], forest: ["land", "creature"], vehicle: ["artifact", "land"], saga: ["enchantment", "creature"] };
  expect(foldThemeTag("enters:treasure", misleading)).toBe("enters:artifact");
  expect(foldThemeTag("enters:forest", misleading)).toBe("enters:land");
  expect(foldThemeTag("enters:vehicle", misleading)).toBe("enters:artifact");
  expect(foldThemeTag("enters:saga", misleading)).toBe("enters:enchantment");
});

// A CARD TYPE IS ITS OWN FAMILY. `hierarchy.json` is keyed on the words after a type line's em
// dash, which includes the card types themselves, and `h["land"]` lists `creature` first -- so
// `enters:land` folded into `enters:creature` and a landfall deck's family was the creature family.
test("a value that is already a card type is never re-folded", () => {
  const misleading = { land: ["land", "creature"], artifact: ["artifact", "creature"], creature: ["creature"] };
  expect(foldThemeTag("enters:land", misleading)).toBe("enters:land");
  expect(foldThemeTag("enters:artifact", misleading)).toBe("enters:artifact");
  expect(foldThemeTag("enters:creature", misleading)).toBe("enters:creature");
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

// A SUPERTYPE IS ITS OWN FAMILY. `legendary` is neither a card type nor a subtype, so SUBTYPE_TYPES
// cannot place it and it fell through to hierarchy.json, whose scraped `legendary` key lists
// `creature` first -- a legends deck's family was the creature family (roadmap A11).
test("a supertype value is never folded into a card type", () => {
  const misleading = { legendary: ["creature", "artifact", "enchantment"], snow: ["land", "creature"] };
  expect(foldThemeTag("enters:legendary", misleading)).toBe("enters:legendary");
  expect(foldThemeTag("enters:snow", misleading)).toBe("enters:snow");
});
