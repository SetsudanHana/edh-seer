import { expect, test } from "vitest";
import type { DeckCard } from "./types.js";
import { commanderDamage } from "./commander-damage.js";

const card = (name: string, typeLine: string, oracleText = "", power: string | null = null): DeckCard => ({
  card: { name, typeLine, oracleText, keywords: [], colors: [], manaValue: 0, power, toughness: power } as never,
  tags: null,
});

const cmd = card("Kratos", "Legendary Creature — God", "", "2");
const sword = card("Sword of Fire and Ice", "Artifact — Equipment", "Equipped creature gets +2/+2.");
const aura = card("Ethereal Armor", "Enchantment — Aura", "Enchant creature\nEnchanted creature gets +1/+1 for each enchantment you control.");

test("commander damage is a RANGE from a bare commander to a fully kitted one", () => {
  const deck = [cmd, sword, card("Bear", "Creature — Bear", "", "2")];
  expect(commanderDamage(deck, ["Kratos"], "voltron")).toEqual([{
    commander: "Kratos", power: 2, attachable: 2, attachableCount: 1,
    // 21 / 2 = 11 connections bare; 21 / (2 + 2) = 6 carrying the Sword.
    bare: 11, kitted: 6,
  }]);
});

// IT REPORTS ONLY WHERE THE DECK IS ACTUALLY TRYING, and the gate is the deck's OWN detected
// archetype rather than a new threshold. A 1-power commander in a spellslinger deck needs twenty-one
// connections — true, useless, and noise.
test("a deck that is not voltron gets no row at all", () => {
  const deck = [cmd, sword];
  expect(commanderDamage(deck, ["Kratos"], "spellslinger")).toEqual([]);
  expect(commanderDamage(deck, ["Kratos"], undefined)).toEqual([]);
});

// A BONUS THIS CANNOT PUT A NUMBER ON CONTRIBUTES ZERO, which under-states the ceiling rather than
// inventing a board state — Ethereal Armor's "+1/+1 for each enchantment" is unreadable here.
test("an unreadable bonus counts as zero power but still counts as a piece", () => {
  const [row] = commanderDamage([cmd, aura], ["Kratos"], "voltron");
  expect(row.attachable).toBe(0);
  expect(row.attachableCount).toBe(1);
  expect(row.kitted).toBe(11);
});

// AN AURA ON SOMETHING THAT IS NOT A CREATURE IS NOT CARRYING ANYONE INTO COMBAT — the same "aura
// only when it enchants a creature" qualifier `ARCHETYPE_SIGNATURE`'s voltron row already keeps.
test("an aura that does not enchant a creature is not attachable", () => {
  const landAura = card("Wild Growth", "Enchantment — Aura", "Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.");
  expect(commanderDamage([cmd, landAura], ["Kratos"], "voltron")[0].attachableCount).toBe(0);
});

// A `*` POWER IS DEFINED BY THE BOARD AND IS NOT A NUMBER THIS CAN DIVIDE BY — no row rather than a
// guess, the same answer `powerOverMv` gives for the same reason.
test("a commander with no readable power yields no row", () => {
  const star = card("Lord of Extinction", "Legendary Creature — Elemental", "", "*");
  expect(commanderDamage([star, sword], ["Lord of Extinction"], "voltron")).toEqual([]);
});
