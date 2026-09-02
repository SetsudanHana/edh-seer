import { expect, test } from "vitest";
import { describeTag } from "./tags.js";
import { themeName, THEME_NAMES } from "./theme-names.js";

/** T2, the owner's finding on their own deck: *"enchantments entering, no MTG player will understand
 *  that, for them the deck would be 'Enchantress' like the theme names on EDHREC"*. */
test("a named archetype reads as the name a player uses", () => {
  expect(themeName("enters:enchantment", describeTag("enters:enchantment"))).toBe("Enchantress");
  expect(themeName("dies:creature", describeTag("dies:creature"))).toBe("Aristocrats");
  expect(themeName("cast:spell", describeTag("cast:spell"))).toBe("Spellslinger");
  expect(themeName("enters:land", describeTag("enters:land"))).toBe("Landfall");
});

/** THE LONG TAIL IS ONE RULE AND NOT 38 ENTRIES. Measured over the 71 calibration decks, most
 *  distinct theme phrases are `enters:<creature type>` seen once each -- walls, constructs,
 *  dinosaurs, rats -- and a player names every one of them the same way. */
test("a creature type entering is typal, whatever the type is", () => {
  expect(themeName("enters:wizard", "wizards entering")).toBe("Wizard typal");
  expect(themeName("enters:dragon", "dragons entering")).toBe("Dragon typal");
  // Multi-word types keep both words capitalised; the corpus really does carry this one.
  expect(themeName("enters:time lord", "time lords entering")).toBe("Time Lord typal");
});

/** The last mechanical phrase standing over the 71 calibration decks, and the same shape as typal:
 *  a deck making one kind of token is named for the token. */
test("a deck that makes one kind of token is named for the token", () => {
  expect(themeName("create-token:goblin", "goblins created")).toBe("Goblin tokens");
  // The general case stays the archetype everyone calls it.
  expect(themeName("create-token:creature", "creatures created")).toBe("Tokens");
});

/** A WRONG NAME IS WORSE THAN AN UNGLAMOROUS TRUE ONE, so anything the table and the rule both miss
 *  keeps the mechanical phrase the engine measured. */
test("an unnamed theme keeps the mechanism, and never invents a tribe", () => {
  // A card type is not a tribe: "Artifact typal" would be wrong and `enters:artifact` is named.
  expect(themeName("enters:artifact", "artifacts entering")).toBe("Artifacts");
  // A negation is written `-creature` by `themeSubjectKey`, and "Non-Creature typal" is not a deck.
  expect(themeName("enters:-creature", "noncreatures entering")).toBe("noncreatures entering");
  // A family with no entry and no rule falls through untouched.
  expect(themeName("static:clone", "clone effects")).toBe("clone effects");
  expect(themeName("attacks:creature", "creatures attacking")).toBe("creatures attacking");
});

/** The table is data and gets edited; these are the invariants an edit must not break. */
test("every entry names a real tag and no name is empty", () => {
  for (const [tag, name] of Object.entries(THEME_NAMES)) {
    expect(name.length, tag).toBeGreaterThan(0);
    // `<verb>:<subject>` or a bare family -- never a trailing colon or an empty subject.
    expect(tag, tag).toMatch(/^[a-z-]+(:[a-z0-9 +/-]+)?$/);
  }
});
