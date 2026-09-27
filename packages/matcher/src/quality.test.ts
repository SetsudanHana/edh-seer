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

test("a modal spell // land keeps its mana value and instant timing (its removal ability carries no face index: CEILING)", () => {
  const sink = ingredients(dc("Sink into Stupor // Soporific Springs"), "targetedRemoval");
  expect(sink.manaValue).toBeTypeOf("number");   // the land back face must not erase it
  expect(sink.timing).toBe(2);                    // the spell face is an instant
});

test("a role the card does not fill has no ingredients", () => {
  expect(ingredients(dc("Counterspell"), "ramp")).toEqual({});
});

test("breadth: any permanent or spell 3 > several types or nonland 2 > one type 1 > restricted 0", () => {
  expect(ingredients(dc("Beast Within"), "targetedRemoval").breadth).toBe(3);
  expect(ingredients(dc("Swords to Plowshares"), "targetedRemoval").breadth).toBe(1);
  expect(ingredients(dc("Counterspell"), "stackInteraction").breadth).toBe(3); // any spell
  expect(ingredients(dc("Sink into Stupor // Soporific Springs"), "targetedRemoval").breadth).toBe(2); // nonland permanent
});

test("permanence: exile 3 > destroy/sacrifice 2 > bounce 1", () => {
  expect(ingredients(dc("Swords to Plowshares"), "targetedRemoval").permanence).toBe(3);
  expect(ingredients(dc("Beast Within"), "targetedRemoval").permanence).toBe(2);
  expect(ingredients(dc("Sink into Stupor // Soporific Springs"), "targetedRemoval").permanence).toBe(1);
});

test("oneSided: Wrath hits everyone; a wipe of only opponents' creatures is one-sided", () => {
  expect(ingredients(dc("Wrath of God"), "boardWipe").oneSided).toBe(0);
  // Cyclonic Rift's overload is not derived (only the targeted bounce), so it cannot prove this; a
  // synthetic Wrath whose dies subject is the opponents' creatures stands in.
  const wrath = dc("Wrath of God");
  const oneSided = { ...wrath, tags: { ...wrath.tags!, abilities: wrath.tags!.abilities.map((a) => ({ ...a, emits: (a.emits ?? []).map((e) => ({ ...e, subject: { ...e.subject, control: "opp" as const } })) })) } };
  expect(ingredients(oneSided, "boardWipe").oneSided).toBe(1);
});

test("rate percentiles for the yield roles: Arcane Signet out-rates Wayfarer's Bauble as ramp", () => {
  const signet = ingredients(dc("Arcane Signet"), "ramp");
  const bauble = ingredients(dc("Wayfarer's Bauble"), "ramp");
  expect(signet.rateFloor).toBeTypeOf("number");
  expect(signet.rateFloor!).toBeGreaterThan(bauble.rateFloor ?? -1);
});

test("drawback: a gift to the opponent (a token, life, a land) or a cost to you", () => {
  expect(ingredients(dc("Beast Within"), "targetedRemoval").drawback).toBe(1);
  // Swords' victim gains life equal to its power: a gift, read off the fixture, not from memory.
  expect(ingredients(dc("Swords to Plowshares"), "targetedRemoval").drawback).toBe(1);
  expect(ingredients(dc("Wrath of God"), "boardWipe").drawback).toBe(0);
});

test("extraValue: a body, or a second ability with its own effect", () => {
  expect(ingredients(dc("Llanowar Elves"), "ramp").extraValue).toBe(1);    // a creature
  expect(ingredients(dc("Mind Stone"), "ramp").extraValue).toBe(1);        // cashes in for a card
  expect(ingredients(dc("Arcane Signet"), "ramp").extraValue).toBe(0);
  expect(ingredients(dc("Swords to Plowshares"), "targetedRemoval").extraValue).toBe(0); // the lifegain is the victim's
});

// ---- the final review's fix pass (2026-09-27) ----

test("the locator finds the role ability the build rules saw: Treasure ramp, a tuck, a phase-out", () => {
  expect(roleAbilities(dc("Smothering Tithe"), "ramp").length).toBeGreaterThan(0);
  expect(roleAbilities(dc("Chaos Warp"), "targetedRemoval").length).toBeGreaterThan(0);
  expect(roleAbilities(dc("Teferi's Protection"), "protection").length).toBeGreaterThan(0);
});

test("a legendary or snow land has no mana value in its role", () => {
  expect(ingredients(dc("Boseiju, Who Endures"), "targetedRemoval").manaValue).toBeUndefined();
});

test("an X in the cost is a missing mana value, never X = 0", () => {
  expect(ingredients(dc("Walking Ballista"), "burn").manaValue).toBeUndefined();
  expect(ingredients(dc("Fireball"), "burn").manaValue).toBeUndefined();
});

test("an activated role ability costs the cast plus the activation (the 09-17 ruling)", () => {
  expect(ingredients(dc("Mind Stone"), "draw").manaValue).toBe(3); // {2} to cast, {1} to cash in
});

test("a wipe whose one-sided or mass mode is not derived is not scored as its cheap targeted mode", () => {
  expect(ingredients(dc("Cyclonic Rift"), "boardWipe")).toEqual({});
  expect(ingredients(dc("Vandalblast"), "boardWipe")).toEqual({});
  expect(ingredients(dc("Wrath of God"), "boardWipe").manaValue).toBe(4);
});
