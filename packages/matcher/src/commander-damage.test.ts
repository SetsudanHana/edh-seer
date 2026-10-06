import { expect, test } from "vitest";
import type { DeckCard } from "./types.js";
import { commanderClock, commanderDamage } from "./commander-damage.js";

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

/** COMMANDER DAMAGE, TIMED FOR THE WHOLE TABLE (#1056 R2; owner 2026-10-06). 21 from one creature to
 *  EACH opponent, and one creature attacks one player a combat, so the table takes three times the
 *  hits. The turn is the earliest t where a commander cast on t (haste assumed) carrying the gear out
 *  by then has hit all three: `t + 3 x hits - 1`. A one-card library is always drawn, so it is exact. */
test("commander damage is timed: cast on 3, carrying +4, hits 2 a player, the table dead on turn 8", () => {
  const big = { ...card("Ox", "Legendary Creature — Ox", "", "7"), card: { ...card("Ox", "Legendary Creature — Ox", "", "7").card, manaValue: 3 } };
  const greaves = { ...sword, card: { ...sword.card, name: "Plate", oracleText: "Equipped creature gets +4/+4.", manaValue: 1 } };
  expect(commanderClock([big, greaves], ["Ox"], "voltron")).toEqual({ commander: "Ox", turn: 8 });
  // Bare, 7 power needs 3 hits a player: cast on 3, nine hits, the table on turn 11.
  expect(commanderClock([big], ["Ox"], "voltron")).toEqual({ commander: "Ox", turn: 11 });
});

test("commander damage is timed only for a voltron deck, and only inside the horizon", () => {
  expect(commanderClock([cmd, sword], ["Kratos"], "go-wide")).toBeUndefined();
  // 2 power bare is 11 hits a player: 33 attacks, past turn 20.
  expect(commanderClock([cmd], ["Kratos"], "voltron")).toEqual({ commander: "Kratos" });
});
