import { expect, test } from "vitest";
import { deriveAbilities } from "./derive.js";
import { grantsSelfOf } from "./grants-self.js";

/** WHO A KEYWORD GRANT LANDS ON, when that is the card itself (#1266, the protection role). Clause texts are the printed lines of real cards (Mongo `cards`, 2026-11-12);
 *  the sentence reader is the one `rules.ts` ran over printed text since #1289, moved here so the role reads a derived fact. */
const SELF: [string, string, string[]][] = [
  ["Adanto Vanguard", "Pay 4 life: This creature gains indestructible until end of turn. (Damage and effects that say \"destroy\" don't destroy it.)", ["indestructible"]],
  ["Agent Frank Horrigan", "Agent Frank Horrigan has indestructible as long as it attacked this turn.", ["indestructible"]],
  ["Dragonlord Ojutai", "Dragonlord Ojutai has hexproof as long as it's untapped.", ["hexproof"]],
  ["Kogla, the Titan Ape", "{1}{G}: Return target Human you control to its owner's hand. Kogla gains indestructible until end of turn.", ["indestructible"]],
  ["Falkenrath Aristocrat", "Sacrifice a creature: This creature gains indestructible until end of turn. If the sacrificed creature was a Human, put a +1/+1 counter on this creature.", ["indestructible"]],
  // "It" after a sentence that names the card and no target.
  ["Hungering Puppetbeast", "{1}, Sacrifice another artifact: Put a +1/+1 counter on this creature. It gains your choice of trample, hexproof, or haste until end of turn.", ["haste", "hexproof", "trample"]],
  // A condition before the recipient is not the recipient.
  ["Erebos's Titan", "As long as your opponents control no creatures, this creature has indestructible. (Damage and effects that say \"destroy\" don't destroy it.)", ["indestructible"]],
];

const NOT_SELF: [string, string, string[]][] = [
  ["Heroic Intervention", "Permanents you control gain hexproof and indestructible until end of turn.", ["hexproof", "indestructible"]],
  ["Selfless Spirit", "Sacrifice this creature: Creatures you control gain indestructible until end of turn.", ["indestructible"]],
  ["Gods Willing", "Target creature you control gains protection from the color of your choice until end of turn. (It can't be blocked, targeted, dealt damage, enchanted, or equipped by anything of that color.)", ["protection"]],
  // "It" after a sentence with a target is the target.
  ["Feat of Resistance", "Put a +1/+1 counter on target creature you control. It gains protection from the color of your choice until end of turn. (It can't be blocked, targeted, dealt damage, enchanted, or equipped by anything of that color.)", ["protection"]],
  ["Swiftfoot Boots", "Equipped creature has hexproof and haste. (It can't be the target of spells or abilities your opponents control. It can attack and {T} no matter when it came under your control.)", ["haste", "hexproof"]],
  ["Avacyn, Angel of Hope", "Other permanents you control have indestructible.", ["indestructible"]],
  ["Leyline of Sanctity", "You have hexproof. (You can't be the target of spells or abilities your opponents control.)", ["hexproof"]],
  // Inside a quoted ability handed to others, "this creature" and "It" are the grantee.
  ["Agent of the Shadow Thieves", "Commander creatures you own have \"Whenever this creature attacks a player, if no opponent has more life than that player, put a +1/+1 counter on this creature. It gains deathtouch and indestructible until end of turn.\"", ["deathtouch", "indestructible"]],
  // No sentence of the clause hands over a keyword of `grants`: nothing is said.
  ["Grizzly Bears", "This creature gets +1/+1 until end of turn.", ["indestructible"]],
];

test("a grant whose recipient is the card itself is read as a self grant", () => {
  for (const [name, text, grants] of SELF) expect(grantsSelfOf(text, grants, name), name).toBe(true);
});

test("a grant to anything else is not a self grant", () => {
  for (const [name, text, grants] of NOT_SELF) expect(grantsSelfOf(text, grants, name), name).toBe(false);
});

test("a clause that grants to the card AND to something else is not a self grant", () => {
  expect(grantsSelfOf("This creature gains indestructible until end of turn. Other creatures you control gain hexproof until end of turn.", ["hexproof", "indestructible"], "Both Sentences")).toBe(false);
  expect(grantsSelfOf("This creature and other creatures you control gain indestructible until end of turn.", ["indestructible"], "Plural Subject")).toBe(false);
});

// Stored clause shapes from `cardClauses` (2026-11-12).
test("derive stamps `grantsSelf` on the card's own grant and on no other", () => {
  const vanguard = "Pay 4 life: This creature gains indestructible until end of turn.";
  const own = deriveAbilities([{ id: 2, abilityType: "activated", actions: [
    { verb: "lose-life", object: "you", amount: "4" },
    { verb: "grant-ability", object: "this creature gains indestructible until end of turn" },
  ] }], "Adanto Vanguard", { 2: vanguard }, { 2: "Pay 4 life" }, vanguard).abilities.filter((a) => a.grants !== undefined);
  expect(own.map((a) => [a.grants, a.grantsSelf])).toEqual([[["indestructible"], true]]);

  const spirit = "Sacrifice this creature: Creatures you control gain indestructible until end of turn.";
  const team = deriveAbilities([{ id: 2, abilityType: "activated", actions: [
    { verb: "sacrifice", object: "this creature" },
    { verb: "grant-ability", object: "indestructible" },
  ] }], "Selfless Spirit", { 2: spirit }, { 2: "Sacrifice this creature" }, spirit).abilities.filter((a) => a.grants !== undefined);
  expect(team.map((a) => [a.grants, a.grantsSelf])).toEqual([[["indestructible"], undefined]]);
});

test("a quoted ability's own grant is the grantee's, never the card's", () => {
  const outer = "Commander creatures you own have \"Whenever this creature attacks a player, if no opponent has more life than that player, put a +1/+1 counter on this creature. It gains deathtouch and indestructible until end of turn.\"";
  const inner = "Whenever this creature attacks a player, if no opponent has more life than that player, put a +1/+1 counter on this creature. It gains deathtouch and indestructible until end of turn.";
  const abilities = deriveAbilities([
    { id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: "that ability" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "attacks", subject: "this creature", control: "you" }, actions: [
      { verb: "add-counter", object: "+1/+1", amount: "1" }, { verb: "grant-ability", object: "deathtouch" }, { verb: "grant-ability", object: "indestructible" },
    ] },
  ], "Agent of the Shadow Thieves", { 1: outer, 2: inner }, undefined, outer, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { 2: 1 }).abilities;
  const granted = abilities.filter((a) => (a.grants ?? []).includes("indestructible"));
  expect(granted.length).toBeGreaterThan(0);
  for (const a of granted) expect(a.grantsSelf).toBeUndefined();
});
