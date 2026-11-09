import { expect, test } from "vitest";
import { nameOnlyTypes } from "./own-name.js";

test("a name word the text never says as a type is name-only; one it says in a class position, or elsewhere, is not (#1570)", () => {
  expect([...nameOnlyTypes("Phelddagrif", "{G}: Phelddagrif gains trample until end of turn.")]).toEqual(["phelddagrif"]);
  expect([...nameOnlyTypes("Human Torch", "Whenever Human Torch attacks, he deals damage.")]).toEqual(["human"]);
  expect([...nameOnlyTypes("Elder Arthur Maxson", "Blind Betrayal — Sacrifice another creature: Elder Arthur Maxson gains indestructible until end of turn.")]).toEqual(["elder"]);
  expect([...nameOnlyTypes("Aurochs", "Whenever this creature attacks, it gets +1/+0 for each other attacking Aurochs.")]).toEqual([]);
  expect([...nameOnlyTypes("Coward // Killer", "Target creature becomes a Coward in addition to its other types.\n//\nKiller deals 3 damage to target creature.")]).toEqual([]);
  expect([...nameOnlyTypes("Goblin Rabblemaster", "Other Goblin creatures you control attack each combat if able.")]).toEqual([]);
  expect([...nameOnlyTypes("Templar Knight", "Tap five untapped attacking creatures you control named Templar Knight: Search.")]).toEqual(["knight"]);
  expect([...nameOnlyTypes("Grizzly Bears", "")]).toEqual(["bear"]);
  expect([...nameOnlyTypes(undefined, "x")]).toEqual([]);
});
