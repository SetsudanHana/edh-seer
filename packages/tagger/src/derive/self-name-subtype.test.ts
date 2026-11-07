import { expect, test } from "vitest";
import { deriveInputOf } from "../derive-input.js";
import { deriveCardTags } from "./derive.js";

// #1568 part 5: a card whose short name is also a creature type ("Wolverine, Best There Is") is not a class of Wolverines in its own damage doubling.
const card = {
  name: "Wolverine, Best There Is", typeLine: "Legendary Creature — Mutant Berserker Hero", keywords: [] as string[],
  oracleText: "Unrivaled Lethality — Double all damage Wolverine would deal.\nAt the beginning of each end step, if Wolverine dealt damage to another creature this turn, put a +1/+1 counter on him.",
};
const records = [
  { id: 1, abilityType: "static", actions: [{ verb: "double", object: "all damage Wolverine would deal", fromZone: null, toZone: null, amount: null, optional: false }] },
];

test("Wolverine's 'double all damage Wolverine would deal' names no Wolverine subtype", () => {
  const tags = deriveCardTags(deriveInputOf(card as never, "x", card.name, records as never));
  expect(JSON.stringify(tags.abilities)).not.toContain("wolverine");
});
