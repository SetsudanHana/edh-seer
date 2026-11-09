import { expect, test } from "vitest";
import { nameOnlyTypes, stripOwnNameSubtypes } from "./own-name.js";

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

test("a reminder text that says the type keeps it (Borg Queen's assimilate), and a ref subject keeps the card's own subtype (#1570)", () => {
  expect([...nameOnlyTypes("The Borg Queen", "Assimilate that card. (To assimilate a card, put it onto the battlefield. It's a Borg artifact creature and loses all other creature types.)")]).toEqual([]);
  const a = { kind: "static", effect: { kind: "graveyard-recursion" }, emits: [{ verb: "enters", subject: { control: "any", token: null, subtype: ["scorpion", "god"], ref: "trigger" } }] } as never;
  const out = stripOwnNameSubtypes(a, new Set(["scorpion", "god"]), new Set(["god"])) as { emits: { subject: { subtype: unknown } }[] };
  expect(out.emits[0]!.subject.subtype).toBe("god");
});
