import { expect, test } from "vitest";
import type { Card } from "@mtg/engine";
import { detectCommanders } from "./commander.js";

function card(partial: Partial<Card> & { name: string }): Card {
  return {
    typeLine: "",
    oracleText: "",
    keywords: [],
    colors: [],
    manaValue: 0,
    colorIdentity: [],
    ...partial,
  };
}

const sorin = card({
  name: "Sorin of House Markov",
  typeLine: "Legendary Creature — Vampire Noble",
  colorIdentity: ["W", "B"],
});
const solRing = card({ name: "Sol Ring", typeLine: "Artifact", colorIdentity: [] });
const bolt = card({ name: "Lightning Bolt", typeLine: "Instant", colorIdentity: ["R"] });

test("detects a legendary creature sitting first in the list as the commander", () => {
  expect(detectCommanders([sorin, solRing, bolt]).map((c) => c.name)).toEqual(["Sorin of House Markov"]);
});

test("returns empty when the first card is not commander-legal", () => {
  // e.g. an alphabetised export that happens to start on a spell — don't guess.
  expect(detectCommanders([solRing, sorin, bolt])).toEqual([]);
});

test("returns empty for an empty deck", () => {
  expect(detectCommanders([])).toEqual([]);
});

test("a planeswalker that can be your commander is detected", () => {
  const teferi = card({
    name: "Commander Teferi",
    typeLine: "Legendary Planeswalker — Teferi",
    oracleText: "Teferi can be your commander.",
    colorIdentity: ["W", "U"],
  });
  expect(detectCommanders([teferi, solRing]).map((c) => c.name)).toEqual(["Commander Teferi"]);
});

test("includes a second commander only for a partner pair", () => {
  const a = card({
    name: "Commander A",
    typeLine: "Legendary Creature — Human",
    oracleText: "Partner (You can have two commanders if both have partner.)",
    colorIdentity: ["W"],
  });
  const b = card({
    name: "Commander B",
    typeLine: "Legendary Creature — Elf",
    oracleText: "Partner",
    colorIdentity: ["G"],
  });
  expect(detectCommanders([a, b, solRing]).map((c) => c.name)).toEqual(["Commander A", "Commander B"]);
});

test("does not treat a second legendary creature as a partner when the first has no pairing ability", () => {
  const loneCommander = card({ name: "Lone Cmdr", typeLine: "Legendary Creature — Human", colorIdentity: ["U"] });
  const legendaryInThe99 = card({ name: "Random Legend", typeLine: "Legendary Creature — Dragon", colorIdentity: ["R"] });
  expect(detectCommanders([loneCommander, legendaryInThe99]).map((c) => c.name)).toEqual(["Lone Cmdr"]);
});

test("pairs a background with its 'choose a Background' commander", () => {
  const cmdr = card({
    name: "Background Cmdr",
    typeLine: "Legendary Creature — Human",
    oracleText: "Choose a Background (You can have a Background as a second commander.)",
    colorIdentity: ["B"],
  });
  const background = card({
    name: "Cunning",
    typeLine: "Legendary Enchantment — Background",
    colorIdentity: ["U"],
  });
  expect(detectCommanders([cmdr, background]).map((c) => c.name)).toEqual(["Background Cmdr", "Cunning"]);
});

test("pairs a background listed FIRST with its creature (order-agnostic)", () => {
  // Real decks (Feywild Visitor + Renari) sometimes list the Background half first.
  const background = card({
    name: "Feywild Visitor",
    typeLine: "Legendary Enchantment — Background",
    colorIdentity: ["U"],
  });
  const cmdr = card({
    name: "Renari, Merchant of Marvels",
    typeLine: "Legendary Creature — Dragon",
    oracleText: "Choose a Background.",
    colorIdentity: ["U"],
  });
  expect(detectCommanders([background, cmdr]).map((c) => c.name)).toEqual(["Feywild Visitor", "Renari, Merchant of Marvels"]);
});
