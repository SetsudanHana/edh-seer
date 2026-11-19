import { expect, test } from "vitest";
import { grammarClauseRecords } from "./clause-record.js";
import { isRestrictionSentence } from "./restriction.js";
import { deriveCardTags } from "../derive/derive.js";
import { deriveInputOf } from "../derive-input.js";
import { isDeckbuildingPermission } from "../segment.js";

// #1670: deck-construction and command-zone clauses are READ (owner 2026-11-18), not dropped. Every oracle text is the corpus's own (Mongo `cards`, 2026-11-19).
const card = (name: string, typeLine: string, oracleText: string, keywords: string[] = []) => ({ name, typeLine, oracleText, keywords });

const PERMISSIONS: [string, string, string][] = [
  ["Dyfed, the Guiding Hand", "Legendary Planeswalker — Dyfed", "Dyfed, the Guiding Hand can be your commander."],
  ["Grizzlegom, Hurloon Hero", "Legendary Creature — Minotaur Warrior", "A deck with this commander can have any land cards."],
  ["Maular, the Next Evolution", "Legendary Creature — Phyrexian Elemental", "A deck with this commander can have creature cards with mana value 7 or greater of any color identity and any basic land cards."],
  ["Whtz, the Bibliophile", "Legendary Creature — Frog Wizard", "A deck with this commander has no maximum deck size."],
  ["Tolabow, Loch Rascal", "Legendary Creature — Frog Wizard", "If Tolabow, Loch Rascal is your commander, the color identity of instant and sorcery cards in your deck can include one color of your choice not in your commander's color identity, and your deck can have any basic land cards."],
];

test("the deckbuilding-permission test reads the five shapes, and no real ability", () => {
  for (const [name, , text] of PERMISSIONS) expect(isDeckbuildingPermission(text), name).toBe(true);
  for (const text of ["Whenever a commander you control deals combat damage to a player, draw a card.", "If you control a commander, draw a card.", "Your commander has flying."]) expect(isDeckbuildingPermission(text), text).toBe(false);
});

test("a deckbuilding clause is claimed as a record with no ability, its printed words kept (the keyword line's record; the bought answer for Lord Windgrace writes `other`, which dropped-clauses counts as a drop)", () => {
  for (const [name, type, text] of PERMISSIONS) {
    const g = grammarClauseRecords(card(name, type, text));
    expect(g.blocker, name).toBeUndefined();
    expect(g.complete, name).toBe(true);
    expect(g.records, name).toEqual([{ id: 1, abilityType: "none", actions: [{ verb: "none", object: text }] }]);
  }
});

test("the rest of the card derives normally beside the clause (Lord Windgrace's own shape)", () => {
  const c = card("Dyfed, the Guiding Hand", "Legendary Planeswalker — Dyfed", "+1: Create two tapped Powerstone tokens.\nDyfed, the Guiding Hand can be your commander.");
  const g = grammarClauseRecords(c);
  expect(g.complete).toBe(true);
  const abilities = deriveCardTags(deriveInputOf(c as never, "x", c.name, g.records, undefined, g.readings)).abilities;
  expect(abilities.map((a) => a.clause)).toEqual([1]);
});

test("derive: a deckbuilding clause emits no ability (Maular)", () => {
  const [, type, text] = PERMISSIONS[2]!;
  const c = card("Maular, the Next Evolution", type, text);
  const g = grammarClauseRecords(c);
  expect(deriveCardTags(deriveInputOf(c as never, "x", c.name, g.records, undefined, g.readings)).abilities).toEqual([]);
});

test("Sahir: the zone rider is read, and the trigger still derives", () => {
  expect(isRestrictionSentence("This ability triggers only if ~ is in the command zone or on the battlefield")).toBe(true);
  expect(isRestrictionSentence("This ability triggers only if you control a Swamp")).toBe(true); // unchanged: a plain condition
  expect(isRestrictionSentence("This ability triggers only if ~ is in your graveyard and you draw a card")).toBe(false);
  // The card's second line (a two-event "whenever ... and whenever ..." with "exactly 1") is another blocker, not this family: the first line is tested alone.
  const full = card("Sahir, Visitor in Darkness", "Legendary Creature — Human Wizard", "Eminence — At the beginning of your upkeep, Sahir deals 1 damage to you. This ability triggers only if Sahir is in the command zone or on the battlefield.\nWhenever a source you control deals exactly 1 damage to you and whenever a spell or ability you control causes you to lose exactly 1 life, put a +1/+1 counter on Sahir. If this is the second time this ability has resolved this turn, draw a card.");
  expect(grammarClauseRecords(full).blocker?.clause).toBe(2); // was clause 1, the rider
  const c = card("Sahir, Visitor in Darkness", "Legendary Creature — Human Wizard", "Eminence — At the beginning of your upkeep, Sahir deals 1 damage to you. This ability triggers only if Sahir is in the command zone or on the battlefield.");
  const g = grammarClauseRecords(c);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  const abilities = deriveCardTags(deriveInputOf(c as never, "x", c.name, g.records, undefined, g.readings)).abilities;
  expect(abilities.length).toBeGreaterThan(0);
  expect(abilities[0]!.trigger?.verbs).toEqual(["upkeep"]);
});

test("The Ignoble Serpent: 'your first upkeep' reads as an upkeep trigger NARROWED to the first, and the command zone is a condition, not a battlefield trigger", () => {
  // The card's second line ("sea monster" is no card type) is another blocker, not this family: the first line is tested alone.
  const full = card("\"The Ignoble Serpent\"", "Legendary Creature — Serpent Noble", "At the beginning of your first upkeep, if \"The Ignoble Serpent\" is in your command zone, mill four cards.\nAt the beginning of your end step, return target sea monster creature card from your graveyard to the battlefield. (Krakens, Leviathans, Octopuses, Serpents, and Whales are sea monsters.)");
  expect(grammarClauseRecords(full).blocker?.clause).toBe(2); // was clause 1, the first upkeep
  const c = card("\"The Ignoble Serpent\"", "Legendary Creature — Serpent Noble", "At the beginning of your first upkeep, if \"The Ignoble Serpent\" is in your command zone, mill four cards.");
  const g = grammarClauseRecords(c);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  expect(g.readings![1]!.trigger![0]).toMatchObject({ event: "upkeep", narrowing: "first" });
  const d = deriveCardTags(deriveInputOf(c as never, "x", c.name, g.records, undefined, g.readings));
  // never a plain every-upkeep mill: the first-upkeep narrowing refuses the claim, visibly
  expect(d.abilities.some((a) => a.clause === 1 && a.trigger?.verbs.includes("upkeep"))).toBe(false);
  // refused and LISTED (the quoted name keeps the command-zone `if` unrepresented; the "first" narrowing would refuse it too), not silently claimed
  expect(d.unknownTriggers).toEqual(["if:upkeep"]);
});
