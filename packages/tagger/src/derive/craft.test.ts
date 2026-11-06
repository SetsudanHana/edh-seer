import { expect, test } from "vitest";
import { craftOf } from "./craft.js";

/** CR 702.167a/b (#1500). Craft lines are the segmenter's clause texts of the real cards (Mongo `cards`, read 2026-11-06). */
const exiles = (text: string): string[] => (craftOf(text)?.actions ?? []).map((a) => `${a.fromZone}: ${a.object}`);

test("a type or subtype without 'card' is a permanent or a graveyard card (702.167b)", () => {
  expect(exiles("Craft with creature {4}{B}")).toEqual(["battlefield: a creature you control", "graveyard: a creature card from your graveyard"]);
  expect(exiles("Craft with Cave {5}{G}")).toEqual(["battlefield: a cave you control", "graveyard: a cave card from your graveyard"]);
  expect(exiles("Craft with two creatures {5}{B}")[0]).toBe("battlefield: a creature you control");
});

test("'cards' is the graveyard only, 'one or more' is any class, a list is one exile per member", () => {
  expect(exiles("Craft with four or more red instant and/or sorcery cards {3}{R}{R}")).toEqual(["graveyard: a red instant and/or sorcery card from your graveyard"]);
  expect(exiles("Craft with one or more {5}")).toEqual(["battlefield: a permanent you control", "graveyard: a card from your graveyard"]);
  expect(exiles("Craft with a Dinosaur, a Merfolk, a Pirate, and a Vampire {4}")).toHaveLength(8);
});

test("the cost is the rule's own words, and a class it cannot name is not read", () => {
  expect(craftOf("Craft with artifact {2}{W}")?.cost).toBe("{2}{W}, Exile this permanent, Exile artifact from among permanents you control and/or cards in your graveyard");
  expect(craftOf("Craft with four or more nonlands with activated abilities {8}{U}")).toBeNull();
  expect(craftOf("Craft with artifact")).toBeNull();
  expect(craftOf("Flying")).toBeNull();
});
