import { expect, test } from "vitest";
import { buildHierarchy, impliesType, expandTypes, PSEUDO_TYPE_SETS, ALL_CARD_TYPES } from "./hierarchy.js";

test("buildHierarchy maps each subtype after the dash to its card types", () => {
  const h = buildHierarchy([
    "Legendary Creature — Human Wizard",
    "Artifact — Treasure",
    "Enchantment — Aura",
    "Basic Land — Mountain",
  ]);
  expect(h.wizard).toContain("creature");
  expect(h.human).toContain("creature");
  expect(h.treasure).toContain("artifact");
  expect(h.aura).toContain("enchantment");
  expect(h.mountain).toContain("land");
});

test("impliesType is true only for a real subtype→type pair", () => {
  const h = { wizard: ["creature"], treasure: ["artifact"] };
  expect(impliesType(h, "wizard", "creature")).toBe(true);
  expect(impliesType(h, "Wizard", "Creature")).toBe(true); // case-insensitive
  expect(impliesType(h, "wizard", "artifact")).toBe(false);
  expect(impliesType(h, "unknownsub", "creature")).toBe(false);
});

test("expandTypes: a concrete type expands to itself", () => {
  expect([...expandTypes(["instant"], [], {})]).toEqual(["instant"]);
});

test("expandTypes: permanent and spell umbrellas expand to their member card types", () => {
  expect(expandTypes(["permanent"], [], {}).has("creature")).toBe(true);
  expect(expandTypes(["permanent"], [], {}).has("instant")).toBe(false); // instants are not permanents
  expect(expandTypes(["spell"], [], {}).has("instant")).toBe(true);
  expect(expandTypes(["spell"], [], {}).has("land")).toBe(false); // lands are not cast
});

test("expandTypes: negations expand to every card type except the negated one", () => {
  const nc = expandTypes(["noncreature"], [], {});
  expect(nc.has("creature")).toBe(false);
  expect(nc.has("instant")).toBe(true);
  const nl = expandTypes(["nonland"], [], {});
  expect(nl.has("land")).toBe(false);
  expect(nl.has("creature")).toBe(true);
});

test("expandTypes: a subtype contributes its implied card types via the hierarchy", () => {
  const h = { wizard: ["creature"] };
  expect(expandTypes([], ["wizard"], h).has("creature")).toBe(true);
});

test("expandTypes: an unknown token contributes nothing", () => {
  expect(expandTypes(["banana", "tribal"], [], {}).size).toBe(0);
});

test("PSEUDO_TYPE_SETS covers the four pseudo-types; ALL_CARD_TYPES has eight", () => {
  expect(Object.keys(PSEUDO_TYPE_SETS).sort()).toEqual(["noncreature", "nonland", "permanent", "spell"]);
  expect(ALL_CARD_TYPES.length).toBe(8);
});
