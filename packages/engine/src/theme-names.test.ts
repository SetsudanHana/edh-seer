import { expect, test } from "vitest";
import { tagName, THEME_NAMES } from "./theme-names.js";

/** T2, the owner's finding on their own deck: *"enchantments entering, no MTG player will understand
 *  that, for them the deck would be 'Enchantress' like the theme names on EDHREC"*. */
test("a named archetype reads as the name a player uses", () => {
  expect(tagName("enters:enchantment")).toBe("Enchantress");
  expect(tagName("dies:creature")).toBe("Aristocrats");
  expect(tagName("cast:instant-sorcery")).toBe("Spellslinger");
  expect(tagName("enters:land")).toBe("Landfall");
});

/** THE LONG TAIL IS ONE RULE AND NOT A TABLE: `enters:<creature type>` is named by its tribe, with the
 *  tribe title-cased (owner 2026-11-24: "Time Lord ETBs"). `scales:<tribe>` is the typal deck. */
test("a creature type entering is named for the tribe, whatever the type is", () => {
  expect(tagName("enters:wizard")).toBe("Wizard ETBs");
  expect(tagName("enters:dragon")).toBe("Dragon ETBs");
  expect(tagName("enters:time lord")).toBe("Time Lord ETBs");
});

/** #616: a deck that COUNTS a tribe is that tribe's deck; it read "counts your Clerics". */
test("a count of a creature type is typal, and a count of a class is not a tribe", () => {
  expect(tagName("scales:cleric")).toBe("Cleric typal");
  expect(tagName("scales:creature")).toBe("Go wide");
  expect(tagName("scales:land")).toBe("Lands matter");
  expect(tagName("scales:party")).toBe("Party");
  expect(tagName("scales:donated")).toBe("Donate");
  expect(tagName("scales:-creature")).toBe("Noncreature spells matter");
});

test("the long-standing mechanical names read in a player's words", () => {
  expect(tagName("static:pump")).toBe("Anthems");
  expect(tagName("fodder:creature")).toBe("Sac fodder");
  expect(tagName("graveyard-recursion:creature")).toBe("Reanimator");
});

test("a deck that makes one kind of token is named for the token", () => {
  expect(tagName("create-token:goblin")).toBe("Goblin tokens");
  // The general case stays the archetype everyone calls it.
  expect(tagName("create-token:creature")).toBe("Tokens");
});

/** A NEGATION IS NOT A TRIBE: `themeSubjectKey` writes one as `-creature`. */
test("a negation is never named for a tribe, and nothing falls to a slug", () => {
  expect(tagName("enters:-creature")).toBe("Noncreature ETBs");
  expect(tagName("some-new-family:thing")).toBe("Thing some new family");
  expect(tagName("some-new-family:any")).toBe("Some new family");
});

/** The chosen-type sentinel is not a type a player can name. */
test("a chosen type that resolved to nothing reads as unchosen", () => {
  expect(tagName("cast:__none__")).toBe("Unchosen type spells");
});

/** The table is data and gets edited; these are the invariants an edit must not break. */
test("every entry names a real tag and no name is empty", () => {
  for (const [tag, name] of Object.entries(THEME_NAMES)) {
    expect(name.length, tag).toBeGreaterThan(0);
    // `<verb>:<subject>` or a bare family -- never a trailing colon or an empty subject.
    expect(tag, tag).toMatch(/^[a-z-]+(:[a-z0-9 +/-]+)?$/);
  }
});
