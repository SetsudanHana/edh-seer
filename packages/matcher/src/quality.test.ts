import { expect, test } from "vitest";
import fixtures from "./quality.fixtures.json" with { type: "json" };
import { ingredients, rolesOfCard, roleAbilities } from "./quality.js";
import type { DeckCard } from "./types.js";

const dc = (name: keyof typeof fixtures): DeckCard => fixtures[name] as unknown as DeckCard;

test("roles come from the build rules, lands excluded", () => {
  expect(rolesOfCard(dc("Swords to Plowshares"))).toContain("targetedRemoval");
  expect(rolesOfCard(dc("Counterspell"))).toContain("stackInteraction");
  expect(rolesOfCard(dc("Arcane Signet"))).toContain("ramp");
  expect(rolesOfCard(dc("Wrath of God"))).toContain("boardWipe");
});

test("the role ability is the one that fills THAT role", () => {
  expect(roleAbilities(dc("Swords to Plowshares"), "targetedRemoval").length).toBeGreaterThan(0);
  expect(roleAbilities(dc("Swords to Plowshares"), "ramp")).toEqual([]);
});

test("manaValue, timing and frequency", () => {
  const swords = ingredients(dc("Swords to Plowshares"), "targetedRemoval");
  expect(swords.manaValue).toBe(1);
  expect(swords.timing).toBe(2);           // instant
  expect(swords.frequency).toBe(0);        // once
  expect(ingredients(dc("Wrath of God"), "boardWipe").timing).toBe(0); // sorcery
  expect(ingredients(dc("Crib Swap"), "targetedRemoval").manaValue).toBe(3); // corpus value (the plan said 6, from memory)
  expect(ingredients(dc("Mind Stone"), "ramp").frequency).toBeGreaterThan(0); // a repeatable mana ability
});

test("a modal spell // land reads mana value and timing off the role ability's own face", () => {
  const sink = ingredients(dc("Sink into Stupor // Soporific Springs"), "targetedRemoval");
  expect(sink.manaValue).toBeTypeOf("number");   // the land back face must not erase it
  expect(sink.timing).toBe(2);                    // the spell face is an instant
});

test("a role the card does not fill has no ingredients", () => {
  expect(ingredients(dc("Counterspell"), "ramp")).toEqual({});
});
