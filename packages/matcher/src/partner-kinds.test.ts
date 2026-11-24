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

// Full corpus oracle text (Mongo `cards`, 2026-11-24): a bare "Partner" last line with no reminder text.
const JESKA = { typeLine: "Legendary Planeswalker — Jeska", oracleText: "Jeska enters with a loyalty counter on her for each time you've cast a commander from the command zone this game.\n0: Choose target creature. Until your next turn, if that creature would deal combat damage to one of your opponents, it deals triple that damage to that player instead.\n−X: Jeska deals X damage to each of up to three targets.\nJeska, Thrice Reborn can be your commander.\nPartner" };
const TEVESH = { typeLine: "Legendary Planeswalker — Szat", oracleText: "+2: Create two 0/1 black Thrull creature tokens.\n+1: You may sacrifice another creature or planeswalker. If you do, draw two cards, then draw another card if the sacrificed permanent was a commander.\n−10: Gain control of all commanders. Put all commanders from the command zone onto the battlefield under your control.\nTevesh Szat, Doom of Fools can be your commander.\nPartner" };
const AKROMA = { typeLine: "Legendary Creature — Angel", oracleText: "Flying, first strike, vigilance, trample\nAt the beginning of each combat, until end of turn, each other creature you control gets +1/+1 if it has flying, +1/+1 if it has first strike, and so on for double strike, deathtouch, haste, hexproof, indestructible, lifelink, menace, protection, reach, trample, vigilance, and partner.\nPartner" };

test.each([["Jeska, Thrice Reborn", JESKA], ["Tevesh Szat, Doom of Fools", TEVESH], ["Akroma, Vision of Ixidor", AKROMA]])("%s ends in a bare Partner line and prints partner", (_n, card) => {
  expect(partnerKindsOf(card)).toEqual(["partner"]);
});

test("a sentence that merely mentions partner is not a Partner line (Akroma's list, without her final line)", () => {
  expect(partnerKindsOf({ typeLine: AKROMA.typeLine, oracleText: AKROMA.oracleText.replace("\nPartner", "") })).toEqual([]);
  expect(partnerKindsOf({})).toEqual([]);
});

test("a group label is slugged to words joined by single hyphens", () => {
  expect(slugOfLabel("Father & Son")).toBe("father-son");
  expect(slugOfLabel("  Friends   forever ")).toBe("friends-forever");
  expect(slugOfLabel("&&")).toBe("");
});
