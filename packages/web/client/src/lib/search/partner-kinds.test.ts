import { expect, test } from "vitest";
import { partnerKindsOf, slugOfLabel } from "./partner-kinds.js";

// Oracle text and type lines as the corpus holds them (read from Mongo `cards`, 2026-11-24).
const REMINDER = "(You can have two commanders if both have partner.)";
const REAL: [string, { oracleText: string; typeLine: string }, string[]][] = [
  ["Thrasios, Triton Hero", { typeLine: "Legendary Creature — Merfolk Wizard", oracleText: `{4}: Scry 1, then reveal the top card of your library.\nPartner ${REMINDER}` }, ["partner"]],
  ["Pako, Arcane Retriever", { typeLine: "Legendary Creature — Elemental Dog", oracleText: "Partner with Haldan, Avid Arcanist\nHaste\nWhenever Pako attacks, exile the top card of each player's library." }, ["partner-with"]],
  ["Sophina, Spearsage Deserter", { typeLine: "Legendary Creature — Human Soldier", oracleText: "Menace\nPartner—Friends forever (You can have two commanders if both have this ability.)" }, ["friends-forever"]],
  ["Donatello, the Brains", { typeLine: "Legendary Creature — Mutant Ninja Turtle", oracleText: "Partner—Character select (You can have two commanders if both have this ability.)" }, ["character-select"]],
  ["Ellie, Brick Master", { typeLine: "Legendary Creature — Human", oracleText: "Partner—Survivors (You can have two commanders if both have this ability.)" }, ["survivors"]],
  ["Kratos, Stoic Father", { typeLine: "Legendary Creature — God Warrior", oracleText: "Partner—Father & son (You can have two commanders if both have this ability.)" }, ["father-son"]],
  ["Wilson, Refined Grizzly", { typeLine: "Legendary Creature — Bear Warrior", oracleText: "Ward {2}\nChoose a Background (You can have a Background as a second commander.)" }, ["chooses-background"]],
  ["Dungeon Delver", { typeLine: "Legendary Enchantment — Background", oracleText: "Commander creatures you own have \"Room abilities of dungeons you own trigger an additional time.\"" }, ["background"]],
  ["Clara Oswald", { typeLine: "Legendary Creature — Human Advisor", oracleText: "If a triggered ability of a Doctor you control triggers, that ability triggers an additional time.\nDoctor's companion (You can have two commanders if the other is the Doctor.)" }, ["doctors-companion"]],
  // two kinds on one card: a named partner AND a Doctor's companion
  ["Amy Pond", { typeLine: "Legendary Creature — Human", oracleText: "Partner with Rory Williams (When this creature enters, target player may put Rory into their hand from their library, then shuffle.)\nDoctor's companion (You can have two commanders if the other is the Doctor.)" }, ["doctors-companion", "partner-with"]],
];

test.each(REAL)("%s prints %j", (_name, card, kinds) => {
  expect(partnerKindsOf(card)).toEqual(kinds);
});

test("a card that merely has the Partner keyword, or mentions a commander, prints no kind (Scryfall tags Jeska and Akroma 'partner')", () => {
  expect(partnerKindsOf({ typeLine: "Legendary Planeswalker — Jeska", oracleText: "Jeska enters with a loyalty counter on her for each time you've cast a commander from the command zone this game." })).toEqual([]);
  expect(partnerKindsOf({})).toEqual([]);
});

test("a group label is slugged to words joined by single hyphens", () => {
  expect(slugOfLabel("Father & Son")).toBe("father-son");
  expect(slugOfLabel("  Friends   forever ")).toBe("friends-forever");
  expect(slugOfLabel("&&")).toBe("");
});
