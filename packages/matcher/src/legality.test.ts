import { expect, test } from "vitest";
import type { Card } from "@mtg/engine";
import { deckLegality } from "./legality.js";

const card = (name: string, typeLine = "Creature — Bear", opts: Partial<Card> = {}): Card => ({
  name, typeLine, oracleText: "", keywords: [], colors: [], manaValue: 2,
  colorIdentity: [], power: null, toughness: null, ...opts,
} as Card);

const cmd = card("Krenko, Mob Boss", "Legendary Creature — Goblin Warrior", { colorIdentity: ["R"] });
// THE SAME name every time, deliberately: distinct filler names would never exercise the BASIC
// exemption, and a guard no test can fire is decoration. Caught by mutation — removing the basic
// check left every test green until this line said `Mountain` rather than `Mountain ${i}`.
const filler = (n: number): Card[] =>
  Array.from({ length: n }, () => card("Mountain", "Basic Land — Mountain", { colorIdentity: ["R"] }));

test("a legal hundred-card deck reports nothing", () => {
  expect(deckLegality({ cards: [cmd, ...filler(99)], commanders: [cmd] })).toEqual([]);
});

test("903.5a counts COPIES, not distinct names", () => {
  const out = deckLegality({ cards: [cmd, ...filler(40)], commanders: [cmd] });
  expect(out.map((f) => f.rule)).toEqual(["size"]);
  expect(out[0].detail).toMatch(/41 cards/);
});

// 903.5b, AND ITS OWN PRINTED EXCEPTION — the engine already modelled the exception
// (`SubjectFilter.named`, 13 corpus cards) and never the rule.
test("903.5b flags a repeated nonbasic, and never a basic or a card that says otherwise", () => {
  const ring = card("Sol Ring", "Artifact");
  const rats = card("Rat Colony", "Creature — Rat",
    { oracleText: "A deck can have any number of cards named Rat Colony." });
  const out = deckLegality({
    cards: [cmd, ring, ring, rats, rats, rats, ...filler(94)],
    commanders: [cmd],
  });
  const dup = out.find((f) => f.rule === "duplicate")!;
  expect(dup.cards).toEqual(["Sol Ring x2"]);
  expect(dup.cards.join()).not.toMatch(/Rat Colony|Mountain/);
});

test("903.5c/d flags a card outside the commander's identity", () => {
  const brainstorm = card("Brainstorm", "Instant", { colorIdentity: ["U"] });
  const out = deckLegality({ cards: [cmd, brainstorm, ...filler(98)], commanders: [cmd] });
  const id = out.find((f) => f.rule === "color-identity")!;
  expect(id.cards).toEqual(["Brainstorm"]);
  expect(id.detail).toMatch(/outside R/);
});

// WITH NO COMMANDER IDENTIFIED THE CHECK IS SKIPPED, not run against an empty identity — otherwise
// EVERY coloured card is flagged and the report is about the parser rather than the deck.
test("no commander means no colour-identity finding", () => {
  const brainstorm = card("Brainstorm", "Instant", { colorIdentity: ["U"] });
  const out = deckLegality({ cards: [brainstorm, ...filler(99)], commanders: [] });
  expect(out.map((f) => f.rule)).not.toContain("color-identity");
});

// 903.3 UNDER-REPORTS ON PURPOSE. The naive reading flagged FIVE of the 71 calibration decks and all
// five were false — four Backgrounds and Will Kenrith, whose own text makes it legal. A report that
// cries wolf is worse than one that stays quiet.
test("903.3 accepts a Background and a card that says it can lead a deck", () => {
  const background = card("Haunted One", "Legendary Enchantment — Background");
  const walker = card("Will Kenrith", "Legendary Planeswalker — Will",
    { oracleText: "Partner with Rowan Kenrith\nWill Kenrith can be your commander." });
  expect(deckLegality({ cards: [cmd, ...filler(99)], commanders: [cmd, background] })
    .map((f) => f.rule)).not.toContain("commander");
  expect(deckLegality({ cards: [walker, ...filler(99)], commanders: [walker] })
    .map((f) => f.rule)).not.toContain("commander");

  // …and a plain nonlegendary creature really is flagged.
  const bear = card("Grizzly Bears");
  expect(deckLegality({ cards: [bear, ...filler(99)], commanders: [bear] })
    .find((f) => f.rule === "commander")?.cards).toEqual(["Grizzly Bears"]);
});

// A Vehicle leads a deck only when it HAS printed power and toughness (CR 903.3).
test("903.3 admits a Vehicle only with printed power and toughness", () => {
  const withPT = card("Vehicle A", "Legendary Artifact — Vehicle", { power: "4", toughness: "3" });
  const without = card("Vehicle B", "Legendary Artifact — Vehicle");
  expect(deckLegality({ cards: [withPT, ...filler(99)], commanders: [withPT] })
    .map((f) => f.rule)).not.toContain("commander");
  expect(deckLegality({ cards: [without, ...filler(99)], commanders: [without] })
    .map((f) => f.rule)).toContain("commander");
});
