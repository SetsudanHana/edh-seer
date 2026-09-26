import { expect, test } from "vitest";
import { themeMatch, whichTheme, type MainTheme } from "./main-theme.js";

const main: MainTheme = { name: "Cleric typal", tag: "enters:cleric", count: 15, nonland: 63 };

test("the main theme's own tag is the main theme; the same subject is part of it", () => {
  expect(themeMatch({ tag: "enters:cleric", helper: false }, main)).toBe("same");
  expect(themeMatch({ tag: "scales:cleric", helper: false }, main)).toBe("part");
  expect(themeMatch({ tag: "scales:party", helper: false }, main)).toBeNull();
});

test("a helper never joins, and a broad subject joins nothing", () => {
  expect(themeMatch({ tag: "enters:cleric", helper: true }, main)).toBeNull();
  const wide: MainTheme = { ...main, tag: "enters:creature" };
  expect(themeMatch({ tag: "dies:creature", helper: false }, wide)).toBeNull();
  expect(themeMatch({ tag: "enters:creature", helper: false }, wide)).toBe("same");
});

test("the second theme is matched after the main one", () => {
  const both: MainTheme = { ...main, second: { name: "Enchantress", tag: "enters:enchantment" } };
  expect(whichTheme({ tag: "enters:enchantment", helper: false }, both)).toEqual({ theme: "second", name: "Enchantress", match: "same" });
  expect(whichTheme({ tag: "scales:cleric", helper: false }, both)).toEqual({ theme: "main", name: "Cleric typal", match: "part" });
  expect(whichTheme({ tag: "dies:goblin", helper: false }, both)).toBeNull();
});
