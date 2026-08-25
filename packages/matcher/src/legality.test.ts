import { expect, test } from "vitest";
import type { Card } from "@mtg/engine";
import { deckLegality } from "./legality.js";
import { commanderDamage } from "./commander-damage.js";

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

// CR 702.124 — J12's partner half. Every licensing form the corpus prints is exercised, because the
// check REPORTS on a pair it cannot license: a form missing here becomes a false positive on a legal
// deck, which is the exact failure the naive 903.3 reading already made once.
const partner = (name: string, text: string, typeLine = "Legendary Creature — Human"): Card =>
  card(name, typeLine, { oracleText: text, colorIdentity: ["R"] });

test("702.124a — two bare Partners are legal together", () => {
  const a = partner("Ghost of Ramirez DePietro", "Partner (You can have two commanders if both have partner.)");
  const b = partner("Silas Renn, Seeker Adept", "Partner (You can have two commanders if both have partner.)");
  expect(deckLegality({ cards: [a, b, ...filler(98)], commanders: [a, b] })).toEqual([]);
});

test("702.124c — Partner with licenses only the card it NAMES", () => {
  const a = partner("Kraum, Ludevic's Opus", "Partner with Ludevic, Necro-Alchemist");
  const named = partner("Ludevic, Necro-Alchemist", "Partner with Kraum, Ludevic's Opus");
  const stranger = partner("Krenko, Mob Boss", "");
  expect(deckLegality({ cards: [a, named, ...filler(98)], commanders: [a, named] })).toEqual([]);
  expect(deckLegality({ cards: [a, stranger, ...filler(98)], commanders: [a, stranger] })
    .map((f) => f.rule)).toContain("pairing");
});

// THE LABEL IS READ, NOT LISTED. The roadmap named Friends forever and the corpus prints four of
// these groups — Character select 6, Survivors 4, Father & son 2 — so a hard-coded list would have
// flagged three legal pairings.
test("a Partner group pairs by its LABEL, and never across two different labels", () => {
  const a = partner("Sophina, Spearsage Deserter", "Partner—Friends forever (You can have two commanders if both have this ability.)");
  const b = partner("Othelm, Sigardian Outcast", "Partner—Friends forever (You can have two commanders if both have this ability.)");
  const other = partner("Survivor", "Partner—Survivors (You can have two commanders if both have this ability.)");
  expect(deckLegality({ cards: [a, b, ...filler(98)], commanders: [a, b] })).toEqual([]);
  expect(deckLegality({ cards: [a, other, ...filler(98)], commanders: [a, other] })
    .map((f) => f.rule)).toContain("pairing");
});

// The four Backgrounds in the calibration corpus, whose partner J4 could not see. All four decks
// pair legally, so this fires on nothing there — it is built for the arbitrary pasted list.
test("a Background is legal only opposite a card that chooses one", () => {
  const bg = card("Haunted One", "Legendary Enchantment — Background", { colorIdentity: ["R"] });
  const chooser = partner("Burakos, Party Leader", "Choose a Background (You can have a Background as a second commander.)");
  expect(deckLegality({ cards: [chooser, bg, ...filler(98)], commanders: [chooser, bg] })).toEqual([]);
  const plain = partner("Krenko, Mob Boss", "");
  expect(deckLegality({ cards: [plain, bg, ...filler(98)], commanders: [plain, bg] })
    .map((f) => f.rule)).toContain("pairing");
});

test("Doctor's companion needs the other to BE a Doctor", () => {
  const donna = partner("Donna Noble", "Doctor's companion (You can have two commanders if the other is the Doctor.)");
  const doc = partner("The Tenth Doctor", "", "Legendary Creature — Time Lord Doctor");
  expect(deckLegality({ cards: [donna, doc, ...filler(98)], commanders: [donna, doc] })).toEqual([]);
  const notDoc = partner("Krenko, Mob Boss", "");
  expect(deckLegality({ cards: [donna, notDoc, ...filler(98)], commanders: [donna, notDoc] })
    .map((f) => f.rule)).toContain("pairing");
});

test("three commanders is never legal, whatever they print", () => {
  const p = (n: string): Card => partner(n, "Partner (You can have two commanders if both have partner.)");
  const [a, b, c3] = [p("A"), p("B"), p("C")];
  const out = deckLegality({ cards: [a, b, c3, ...filler(97)], commanders: [a, b, c3] });
  expect(out.map((f) => f.rule)).toContain("pairing");
  expect(out.find((f) => f.rule === "pairing")!.detail).toMatch(/3 commanders/);
});

// J12 also filed "a partner pair is two independent 21-damage clocks, which J2 does not split".
// FALSE — `commanderDamage` already loops over every commander and emits one row each. No two-
// commander deck in the corpus detects voltron, so a unit test is the only instrument that can see
// it, the same position `SubjectFilter.named` has been in since it shipped.
test("commander damage is per commander, so a partner pair gets two clocks", () => {
  const a = card("A", "Legendary Creature — Human", { power: "3", toughness: "3" });
  const b = card("B", "Legendary Creature — Human", { power: "7", toughness: "7" });
  const rows = commanderDamage([{ card: a }, { card: b }] as never, ["A", "B"], "voltron");
  expect(rows.map((r) => [r.commander, r.bare])).toEqual([["A", 7], ["B", 3]]);
});

// FOUND IN A LIVE BROWSER, NOT IN ANY TEST (2026-08-25). A Moxfield export lists the commander in
// the decklist as well as naming it, so the same card arrives twice — the tool's OWN example deck
// did — and the pairing rule then flagged "Krenko, Mob Boss · Krenko, Mob Boss" as an illegal pair,
// because a card does not partner with itself. One card is one commander.
test("the same commander named twice is one commander, not an illegal pair", () => {
  expect(deckLegality({ cards: [cmd, cmd, ...filler(98)], commanders: [cmd, cmd] })
    .map((f) => f.rule)).not.toContain("pairing");
});
