import { expect, test } from "vitest";
import { buildHierarchy, impliesType } from "./hierarchy.js";

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
