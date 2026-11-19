import { expect, test } from "vitest";
import type { Card } from "@edh-seer/engine";
import { choosesColour, deckLegality, upcomingCards } from "./legality.js";
import { companionFindings } from "./deck-rules.js";
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

// THE LABEL PARSE IS NOT A REGEX ANY MORE (CodeQL js/polynomial-redos, alert #74, 2026-09-05).
// `/(?:^|\n)Partner—([^(\n]+?)\s*\(/i` let the lazy group and the `\s*` after it both match a
// space, so a line of "Partner—" followed by many spaces and NO "(" backtracked quadratically --
// and oracle text reaches this straight from a pasted decklist, so the input is not ours.
// The bound below is deliberately loose: it is there to fail if the quadratic behaviour ever comes
// back, not to measure anything.
test("a partner label with no reminder text is parsed in linear time, not quadratic", () => {
  // TWO commanders, because `partnerLabel` only runs on the PAIRING path. Measured on the old
  // regex: 2,000 spaces 2.5ms, 8,000 28.5ms, 16,000 167ms, 32,000 389ms -- four times the work for
  // twice the input, which is the quadratic signature. At 60,000 the old regex needs seconds.
  const evil = (name: string) => partner(name, `Partner—${" ".repeat(60_000)}`);
  const a = evil("Adversary"), b = evil("Accomplice");
  const t0 = performance.now();
  deckLegality({ cards: [a, b, ...filler(98)], commanders: [a, b] });
  expect(performance.now() - t0).toBeLessThan(1_000);
});

// The label still has to survive the ordinary shapes, including the ones the regex handled by
// accident: leading whitespace inside the label, and a second ability line above it.
test("a partner label is read off its own line, trimmed, and only up to the reminder text", () => {
  const a = partner("A", "Flying\nPartner—Friends forever  (You can have two commanders if both have this ability.)");
  const b = partner("B", "Partner—friends FOREVER (You can have two commanders if both have this ability.)");
  expect(deckLegality({ cards: [a, b, ...filler(98)], commanders: [a, b] })).toEqual([]);
  // A "Partner—" with no reminder text names no group, so it licenses no pairing.
  const bare = partner("C", "Partner—Friends forever");
  expect(deckLegality({ cards: [a, bare, ...filler(98)], commanders: [a, bare] })
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

/** CR 702.124m: "a legendary Time Lord Doctor creature card that has NO OTHER creature types"
 *  (owner, 2026-09-27: a companion was offered a creature that is only typed Doctor). */
test("Doctor's companion needs the Doctor: a Time Lord Doctor and nothing else", () => {
  const donna = partner("Donna Noble", "Doctor's companion (You can have two commanders if the other is the Doctor.)");
  const pairs = (typeLine: string) => deckLegality({
    cards: [donna, partner("X", "", typeLine), ...filler(98)], commanders: [donna, partner("X", "", typeLine)],
  }).every((f) => f.rule !== "pairing");
  expect(pairs("Legendary Creature — Time Lord Doctor")).toBe(true);
  expect(pairs("Legendary Creature — Human Doctor")).toBe(false);
  expect(pairs("Legendary Creature — Time Lord Doctor Human")).toBe(false);
  expect(pairs("Creature — Time Lord Doctor")).toBe(false);
  expect(pairs("Legendary Artifact — Doctor")).toBe(false);
  // A long run of spaces does not stall the read (CodeQL: polynomial regex on library input).
  const t0 = Date.now();
  expect(pairs(`Legendary Creature${" ".repeat(50_000)}x`)).toBe(false);
  expect(Date.now() - t0).toBeLessThan(500);
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

/** CR 903.4b: a commander whose static makes you choose its colour before the game has that colour
 *  in its identity. Three corpus cards print the sentence (2026-09-05): Clara Oswald, The Prismatic
 *  Piper, Faceless One. The regex is written against Clara's printed text. */
test("903.4b — a card that chooses its colour before the game is recognised", () => {
  const clara = card("Clara Oswald", "Legendary Creature — Human Advisor", {
    oracleText: "Impossible Girl — If Clara Oswald is your commander, choose a color before the game begins. Clara Oswald is the chosen color.\nDoctor's companion (You can have two commanders if the other is the Doctor.)",
  });
  expect(choosesColour(clara)).toBe(true);
  expect(choosesColour(cmd)).toBe(false);
});

// ---------------------------------------------------------------------------------------------
// CARDS THAT CHANGE DECK CONSTRUCTION (deck-rules.ts, owner 2026-09-22). Oracle text below is the
// corpus's own, copied from Mongo on 2026-09-22, not written from memory.
// ---------------------------------------------------------------------------------------------

const deckOf = (commander: Card, rest: Card[]): Card[] => [commander, ...rest, ...filler(99 - rest.length)];

test("903.5b's capped exception: up to seven Seven Dwarves is legal, eight is not", () => {
  const dwarves = (n: number) => Array.from({ length: n }, () => card("Seven Dwarves", "Creature — Dwarf", {
    colorIdentity: ["R"], oracleText: "Seven Dwarves gets +1/+1 for each other creature named Seven Dwarves you control.\nA deck can have up to seven cards named Seven Dwarves.",
  }));
  expect(deckLegality({ cards: deckOf(cmd, dwarves(7)), commanders: [cmd] })).toEqual([]);
  expect(deckLegality({ cards: deckOf(cmd, dwarves(8)), commanders: [cmd] }).map((f) => f.rule)).toEqual(["duplicate"]);
});

test("903.4b: a choose-a-colour commander allows ONE colour outside its printed identity, never two", () => {
  const clara = card("Clara Oswald", "Legendary Creature — Human Advisor", {
    colorIdentity: [], oracleText: "Impossible Girl — If Clara Oswald is your commander, choose a color before the game begins. Clara Oswald is the chosen color.",
  });
  const red = card("Shock", "Instant", { colorIdentity: ["R"] });
  const blue = card("Opt", "Instant", { colorIdentity: ["U"] });
  expect(deckLegality({ cards: deckOf(clara, [red]), commanders: [clara] }).map((f) => f.rule)).toEqual([]);
  expect(deckLegality({ cards: deckOf(clara, [red, blue]), commanders: [clara] }).map((f) => f.rule)).toEqual(["color-identity"]);
});

test("banned and not-legal cards are reported from the card's own Commander legality", () => {
  const crypt = card("Mana Crypt", "Artifact", { commanderLegality: "banned" });
  const un = card("Sovereign's Plaything", "Artifact", { commanderLegality: "not_legal" });
  const rules = deckLegality({ cards: deckOf(cmd, [crypt, un]), commanders: [cmd] });
  expect(rules.find((f) => f.rule === "banned")?.cards).toEqual(["Mana Crypt"]);
  expect(rules.find((f) => f.rule === "not-legal")?.cards).toEqual(["Sovereign's Plaything"]);
});

const LURRUS = card("Lurrus of the Dream-Den", "Legendary Creature — Cat Nightmare", {
  colorIdentity: ["W", "B"], manaValue: 3,
  oracleText: "Companion — Each permanent card in your starting deck has mana value 2 or less. (If this card is your chosen companion, you may put it into your hand from outside the game for {3} as a sorcery.)\nLifelink",
});
const WB = card("Teysa Karlov", "Legendary Creature — Human Advisor", { colorIdentity: ["W", "B"], manaValue: 4 });
const cheap = (n: number): Card[] => Array.from({ length: n }, () => card("Plains", "Basic Land — Plains", { colorIdentity: ["W"], manaValue: 0 }));

// 702.139a/b and 903.11a.
test("702.139b: a companion's condition counts the COMMANDER as part of the starting deck", () => {
  // A synthetic W/B two-drop: the only thing under test is its mana value against Lurrus.
  const cheapCmd = card("Two-Drop Commander", "Legendary Creature — Human Soldier", { colorIdentity: ["W", "B"], manaValue: 2 });
  expect(deckLegality({ cards: [cheapCmd, ...cheap(99)], commanders: [cheapCmd], companions: [LURRUS] })).toEqual([]);
  // Teysa is a four-drop PERMANENT and she is in the starting deck in a Commander game.
  const out = deckLegality({ cards: [WB, ...cheap(99)], commanders: [WB], companions: [LURRUS] });
  expect(out.map((f) => f.rule)).toEqual(["companion"]);
  expect(out[0]!.cards).toEqual(["Teysa Karlov"]);
  // One card, and the sentence agrees with it ("1 card are" shipped in the first browser check).
  expect(out[0]!.detail).toMatch(/1 card is a permanent over mana value 2$/);
});

test("903.11a: a companion may not share a name with the deck nor leave the commander's identity", () => {
  const redCompanion = card("Obosh, the Preypiercer", "Legendary Creature — Horror", {
    colorIdentity: ["B", "R"], oracleText: "Companion — Your starting deck contains only cards with odd mana values and land cards.",
  });
  const out = deckLegality({ cards: [WB, ...cheap(99)], commanders: [WB], companions: [redCompanion] });
  expect(out.some((f) => /outside your commander's colour identity/.test(f.detail))).toBe(true);
  const dup = deckLegality({ cards: [WB, LURRUS, ...cheap(98)], commanders: [WB], companions: [LURRUS] });
  expect(dup.some((f) => /also in the deck/.test(f.detail))).toBe(true);
});

test("702.139a: one companion only, and a card with no Companion ability cannot be one", () => {
  const plain = card("Sol Ring", "Artifact", { manaValue: 1 });
  const out = deckLegality({ cards: [cmd, ...filler(99)], commanders: [cmd], companions: [plain] });
  expect(out.find((f) => f.rule === "companion")?.detail).toMatch(/no Companion ability/);
  const two = deckLegality({ cards: [WB, ...cheap(99)], commanders: [WB], companions: [LURRUS, { ...LURRUS, name: "Other Companion" }] });
  expect(two.some((f) => /may reveal only one/.test(f.detail))).toBe(true);
});

test("903.5a: Yorion can never be met in a 100-card format, and says so", () => {
  const yorion = card("Yorion, Sky Nomad", "Legendary Creature — Bird Serpent", {
    colorIdentity: ["W", "U"], oracleText: "Companion — Your starting deck contains at least twenty cards more than the minimum deck size.",
  });
  const wu = card("Brago, King Eternal", "Legendary Creature — Spirit", { colorIdentity: ["W", "U"] });
  const out = deckLegality({ cards: [wu, ...cheap(99)], commanders: [wu], companions: [yorion] });
  expect(out.find((f) => f.rule === "companion")?.detail).toMatch(/exactly 100 cards/);
});

test("702.73a: Kaheera accepts a changeling as every creature type", () => {
  const kaheera = card("Kaheera, the Orphanguard", "Legendary Creature — Cat Beast", {
    colorIdentity: ["G", "W"], oracleText: "Companion — Each creature card in your starting deck is a Cat, Elemental, Nightmare, Dinosaur, or Beast card.",
  });
  const gw = card("Arahbo, Roar of the World", "Legendary Creature — Cat Avatar", { colorIdentity: ["G", "W"] });
  const shifter = card("Changeling Outcast", "Creature — Shapeshifter", { keywords: ["Changeling"] });
  const bear = card("Grizzly Bears", "Creature — Bear");
  const lands = (n: number) => Array.from({ length: n }, () => card("Forest", "Basic Land — Forest", { colorIdentity: ["G"] }));
  expect(deckLegality({ cards: [gw, shifter, ...lands(98)], commanders: [gw], companions: [kaheera] })).toEqual([]);
  expect(deckLegality({ cards: [gw, bear, ...lands(98)], commanders: [gw], companions: [kaheera] })[0]!.cards).toEqual(["Grizzly Bears"]);
});

test("712.8a: Umori reads a double-faced card by its FRONT face", () => {
  const umori = card("Umori, the Collector", "Legendary Creature — Ooze", {
    colorIdentity: ["B", "G"], oracleText: "Companion — Each nonland card in your starting deck shares a card type.",
  });
  const bg = card("Meren of Clan Nel Toth", "Legendary Creature — Human Shaman", { colorIdentity: ["B", "G"] });
  const mdfc = card("Tangled Florahedron // Tangled Vale", "Creature — Elf Druid // Land");
  const spell = card("Cultivate", "Sorcery");
  const lands = (n: number) => Array.from({ length: n }, () => card("Swamp", "Basic Land — Swamp", { colorIdentity: ["B"] }));
  expect(deckLegality({ cards: [bg, mdfc, ...lands(98)], commanders: [bg], companions: [umori] })).toEqual([]);
  expect(deckLegality({ cards: [bg, mdfc, spell, ...lands(97)], commanders: [bg], companions: [umori] }).map((f) => f.rule)).toEqual(["companion"]);
});

test("a companion condition this tool cannot read is reported as NOT CHECKED, never passed", () => {
  const zirda = card("Zirda, the Dawnwaker", "Legendary Creature — Elemental Fox", {
    colorIdentity: ["R", "W"], oracleText: "Companion — Each permanent card in your starting deck has an activated ability.",
  });
  const rw = card("Feather, the Redeemed", "Legendary Creature — Angel", { colorIdentity: ["R", "W"] });
  const out = deckLegality({ cards: [rw, ...filler(99)], commanders: [rw], companions: [zirda] });
  expect(out.map((f) => f.rule)).toEqual(["unchecked"]);
});

test("a card that changes deck construction in wording no rule reads is reported, never passed", () => {
  // Invented wording on purpose: this is the net for a mechanic printed after the table was built.
  const novel = card("Future Rule Card", "Artifact", { oracleText: "Your starting deck may have two commanders of any kind." });
  const out = deckLegality({ cards: deckOf(cmd, [novel]), commanders: [cmd] });
  expect(out).toEqual([{ rule: "unchecked", detail: expect.stringMatching(/does not check/), cards: ["Future Rule Card"] }]);
});

test("Sovereign's Realm forbids basics when it is in the deck", () => {
  const realm = card("Sovereign's Realm", "Enchantment", { oracleText: "Your starting deck can't have basic land cards and your starting hand size is five." });
  const out = deckLegality({ cards: deckOf(cmd, [realm]), commanders: [cmd] });
  expect(out.map((f) => f.rule)).toEqual(["construction"]);
  expect(out[0]!.cards).toEqual(["Mountain"]);
});

// REVIEW FINDINGS, 2026-09-22 -- each reproduced before it was fixed.

test("903.4b: a choose-a-colour commander's ONE extra colour is shared by deck and companion", () => {
  const clara = card("Clara Oswald", "Legendary Creature — Human Advisor", {
    colorIdentity: [], oracleText: "If Clara Oswald is your commander, choose a color before the game begins.",
  });
  const jegantha = card("Jegantha, the Wellspring", "Legendary Creature — Elemental Elk", {
    colorIdentity: ["W", "U", "B", "R", "G"],
    oracleText: "Companion — No card in your starting deck has more than one of the same mana symbol in its mana cost.",
  });
  const out = deckLegality({ cards: [clara, ...filler(99)], commanders: [clara], companions: [jegantha] });
  expect(out.some((f) => /outside your commander's colour identity/.test(f.detail))).toBe(true);
  // One colour, and it is the colour the deck already chose: legal.
  const redCompanion = { ...jegantha, name: "Red Companion", colorIdentity: ["R"] };
  const withRed = deckLegality({ cards: [clara, ...filler(99)], commanders: [clara], companions: [redCompanion] });
  expect(withRed.some((f) => /colour identity/.test(f.detail))).toBe(false);
});

test("a companion name that did not resolve is reported by legality, not silently dropped", () => {
  const out = deckLegality({ cards: [cmd, ...filler(99)], commanders: [cmd], unresolvedCompanions: ["Lurus of the Dream Den"] });
  expect(out).toEqual([{ rule: "unchecked", detail: expect.stringMatching(/not recognised/), cards: ["Lurus of the Dream Den"] }]);
});

test("'before the game begins' in a flavour clause is not a deck-building rule", () => {
  const flavour = card("Rule Zero Card", "Creature — Human", { oracleText: "Before the game begins, each player may tell a story." });
  expect(deckLegality({ cards: deckOf(cmd, [flavour]), commanders: [cmd] })).toEqual([]);
});

test("a copy cap this cannot read is reported, never read as ONE (which would flag a legal deck)", () => {
  const odd = (n: number) => Array.from({ length: n }, () => card("Many Rats", "Creature — Rat", {
    colorIdentity: ["R"], oracleText: "A deck can have up to umpteen cards named Many Rats.",
  }));
  const out = deckLegality({ cards: deckOf(cmd, odd(12)), commanders: [cmd] });
  expect(out.map((f) => f.rule)).toEqual(["unchecked"]);
  // And a spelled-out cap past ten is read.
  const eleven = (n: number) => Array.from({ length: n }, () => card("Eleven Rats", "Creature — Rat", {
    colorIdentity: ["R"], oracleText: "A deck can have up to eleven cards named Eleven Rats.",
  }));
  expect(deckLegality({ cards: deckOf(cmd, eleven(11)), commanders: [cmd] })).toEqual([]);
  expect(deckLegality({ cards: deckOf(cmd, eleven(12)), commanders: [cmd] }).map((f) => f.rule)).toEqual(["duplicate"]);
});

test("companions read the FRONT face: a Sorcery // Land modal DFC is a nonland card for Keruga (#1167)", () => {
  const keruga = card("Keruga, the Macrosage", "Legendary Creature — Dragon", {
    colorIdentity: ["G", "U"], oracleText: "Companion — Your starting deck contains only cards with mana value 3 or greater and land cards.",
  });
  const mdfc = card("Shatterskull Smashing // Shatterskull, the Hammer Pass", "Sorcery // Land", { layout: "modal_dfc", manaValue: 2 });
  const out = companionFindings(keruga, { cards: [mdfc, ...filler(3)], commanders: [] } as never);
  expect(out.map((f) => f.cards)).toEqual([[mdfc.name]]);
});

// OWNER 2026-10-25: an unreleased spoiler card is previewed. It reads commander-legal (task 1), so no
// not-legal finding; the report lists it separately, as information and never a rule failure.
test("an upcoming card is no violation and is listed with its date; a real not_legal card is still flagged", () => {
  const spoiler = card("Captain Kirk, Boldly Going", "Legendary Creature — Human", { colorIdentity: ["R"], commanderLegality: "legal", upcoming: "2026-11-13" } as Partial<Card>);
  const bad = card("Time Flamingo", "Creature — Bird", { commanderLegality: "not_legal" } as Partial<Card>);
  expect(deckLegality({ cards: [spoiler, ...filler(99)], commanders: [spoiler] })).toEqual([]);
  expect(upcomingCards([spoiler, spoiler, ...filler(3)])).toEqual([{ name: "Captain Kirk, Boldly Going", date: "2026-11-13" }]);
  expect(upcomingCards(filler(3))).toEqual([]);
  expect(deckLegality({ cards: [cmd, bad, ...filler(98)], commanders: [cmd] }).map((f) => f.rule)).toEqual(["not-legal"]);
});

// #1670 (owner 2026-11-18): the commander's printed deck rules feed legality. Oracle text is the
// corpus's own (Mongo `cards`, 2026-11-19). Each commander gets a synthetic deck that shows the
// finding BEFORE the rule is read (the same cards under a commander without it) and its absence AFTER.
const RULEBREAKER = (name: string, typeLine: string, ci: string[], oracleText: string): Card =>
  card(name, typeLine, { colorIdentity: ci, oracleText });
const basicIn = (n: string, ci: string): Card => card(n, `Basic Land — ${n}`, { colorIdentity: [ci], manaValue: 0 });
const plainCmd = (ci: string[]): Card => card("Plain Commander", "Legendary Creature — Bear", { colorIdentity: ci });
// Colourless padding, so the Mountain filler's red never shows up in an identity finding.
const wastes = (n: number): Card[] => Array.from({ length: n }, () => card("Wastes", "Basic Land", { colorIdentity: [], manaValue: 0 }));
const identityFinding = (commander: Card, cards: Card[]) =>
  deckLegality({ cards: [commander, ...cards, ...wastes(99 - cards.length)], commanders: [commander] }).find((f) => f.rule === "color-identity");

test("Seluma: Angel cards of any colour identity, and basics, but not other off-colour cards", () => {
  const seluma = RULEBREAKER("Seluma, Light of Aysen", "Legendary Creature — Angel Warrior", ["W"],
    "Rulebreaker — A deck with this commander can have Angel cards of any color identity and any basic land cards.\nFlying");
  const angel = card("Angel of the Dire Hour", "Creature — Angel", { colorIdentity: ["B"] });
  const bear = card("Grizzly Bears", "Creature — Bear", { colorIdentity: ["G"] });
  const swamp = basicIn("Swamp", "B");
  const deck = [angel, swamp, bear];
  expect(identityFinding(plainCmd(["W"]), deck)!.cards).toEqual(["Angel of the Dire Hour", "Grizzly Bears", "Swamp"]);
  const after = identityFinding(seluma, deck)!;
  expect(after.cards).toEqual(["Grizzly Bears"]);
  expect(after.detail).toMatch(/Seluma, Light of Aysen exempts Angel cards, basic land cards/);
  expect(identityFinding(seluma, [angel, swamp])).toBeUndefined();
});

test("Maular: creature cards with mana value 7 or greater, not a small creature", () => {
  const maular = RULEBREAKER("Maular, the Next Evolution", "Legendary Creature — Dinosaur Mutant", ["G"],
    "Rulebreaker — A deck with this commander can have creature cards with mana value 7 or greater of any color identity and any basic land cards.");
  const big = card("Elesh Norn, Grand Cenobite", "Legendary Creature — Phyrexian Praetor", { colorIdentity: ["W"], manaValue: 7 });
  const small = card("Angel of Serenity Jr", "Creature — Angel", { colorIdentity: ["W"], manaValue: 6 });
  const bigSpell = card("Big Sorcery", "Sorcery", { colorIdentity: ["W"], manaValue: 8 });
  expect(identityFinding(plainCmd(["G"]), [big])!.cards).toEqual(["Elesh Norn, Grand Cenobite"]);
  expect(identityFinding(maular, [big])).toBeUndefined();
  expect(identityFinding(maular, [big, small, bigSpell])!.cards).toEqual(["Angel of Serenity Jr", "Big Sorcery"]);
});

test("The Everforger: (artifact creature) or Equipment, never a plain artifact", () => {
  const ever = RULEBREAKER("The Everforger", "Legendary Artifact Creature — Construct", [],
    "Rulebreaker — A deck with this commander can have artifact creature and Equipment cards of any color identity and any basic land cards.");
  const golem = card("Red Golem", "Artifact Creature — Golem", { colorIdentity: ["R"] });
  const sword = card("Sword of Fire", "Artifact — Equipment", { colorIdentity: ["R"] });
  const vial = card("Red Vial", "Artifact", { colorIdentity: ["R"] });
  const cr = card("Plain Creature", "Creature — Elf", { colorIdentity: ["R"] });
  expect(identityFinding(ever, [golem, sword, vial, cr])!.cards).toEqual(["Plain Creature", "Red Vial"]);
  expect(identityFinding(ever, [golem, sword])).toBeUndefined();
  expect(identityFinding(plainCmd([]), [golem, sword])!.cards).toEqual(["Red Golem", "Sword of Fire"]);
});

test("The Unluckiest Planeswalker (Aura) and Valko Indorian (Phyrexian)", () => {
  const walker = RULEBREAKER("The Unluckiest Planeswalker", "Legendary Planeswalker", ["R"],
    "Rulebreaker — A deck with this commander can have Aura cards of any color identity and any basic land cards.\nThe Unluckiest Planeswalker can be your commander.");
  const aura = card("Rancor", "Enchantment — Aura", { colorIdentity: ["G"] });
  const ench = card("Phyrexian Arena", "Enchantment", { colorIdentity: ["B"] });
  expect(identityFinding(plainCmd(["R"]), [aura])).toBeDefined();
  expect(identityFinding(walker, [aura])).toBeUndefined();
  expect(identityFinding(walker, [aura, ench])!.cards).toEqual(["Phyrexian Arena"]);
  const valko = RULEBREAKER("Valko Indorian", "Legendary Creature — Human Wizard", ["B"],
    "Rulebreaker — A deck with this commander can have Phyrexian cards of any color identity and any basic land cards.");
  const norn = card("Elesh Norn, Grand Cenobite", "Legendary Creature — Phyrexian Praetor", { colorIdentity: ["W"] });
  const angel = card("Angel", "Creature — Angel", { colorIdentity: ["W"] });
  expect(identityFinding(plainCmd(["B"]), [norn])).toBeDefined();
  expect(identityFinding(valko, [norn])).toBeUndefined();
  expect(identityFinding(valko, [norn, angel])!.cards).toEqual(["Angel"]);
});

test("a printed X this reader cannot parse exempts nothing and says so", () => {
  const odd = RULEBREAKER("Odd Commander", "Legendary Creature — Bear", ["W"],
    "Rulebreaker — A deck with this commander can have nonland cards from any set of any color identity and any basic land cards.");
  const bolt = card("Lightning Bolt", "Instant", { colorIdentity: ["R"] });
  const f = identityFinding(odd, [bolt, basicIn("Mountain", "R")])!;
  expect(f.cards).toEqual(["Lightning Bolt"]);
  expect(f.detail).toMatch(/not read, so not exempted: nonland cards from any set/);
});

test("Grizzlegom: any land cards, not a nonland card", () => {
  const griz = RULEBREAKER("Grizzlegom, Hurloon Hero", "Legendary Creature — Minotaur Warrior", ["G", "R"],
    "Rulebreaker — A deck with this commander can have any land cards.");
  const land = card("Watery Grave", "Land — Island Swamp", { colorIdentity: ["U", "B"] });
  const bolt = card("Counterspell", "Instant", { colorIdentity: ["U"] });
  expect(identityFinding(plainCmd(["G", "R"]), [land])).toBeDefined();
  expect(identityFinding(griz, [land])).toBeUndefined();
  expect(identityFinding(griz, [land, bolt])!.cards).toEqual(["Counterspell"]);
});

test("a deck rule printed on a card in the 99 grants nothing", () => {
  const griz = RULEBREAKER("Grizzlegom, Hurloon Hero", "Legendary Creature — Minotaur Warrior", ["G", "R"],
    "Rulebreaker — A deck with this commander can have any land cards.");
  const land = card("Watery Grave", "Land — Island Swamp", { colorIdentity: ["U", "B"] });
  const out = deckLegality({ cards: [cmd, griz, land, ...filler(97)], commanders: [cmd] });
  expect(out.find((f) => f.rule === "color-identity")!.cards).toEqual(["Grizzlegom, Hurloon Hero", "Watery Grave"]);
});

test("Whtz: no maximum deck size suppresses too many, never too few", () => {
  const whtz = RULEBREAKER("Whtz, the Bibliophile", "Legendary Creature — Homunculus", ["U", "W"],
    "Rulebreaker — A deck with this commander has no maximum deck size.\n{3}, {T}: You draw a card and gain 1 life.");
  const mt = (n: number): Card[] => Array.from({ length: n }, () => card("Island", "Basic Land — Island", { colorIdentity: ["U"] }));
  const over = (c: Card) => deckLegality({ cards: [c, ...mt(149)], commanders: [c] }).map((f) => f.rule);
  expect(over(plainCmd(["U"]))).toContain("size");
  expect(over(whtz)).not.toContain("size");
  const few = deckLegality({ cards: [whtz, ...mt(59)], commanders: [whtz] });
  expect(few.find((f) => f.rule === "size")!.detail).toMatch(/60 cards/);
});

test("Tolabow: ONE extra colour for instants and sorceries, the same for all, and basics", () => {
  const tolabow = RULEBREAKER("Tolabow, Loch Rascal", "Legendary Creature — Otter", ["U"],
    "Rulebreaker — If Tolabow, Loch Rascal is your commander, the color identity of instant and sorcery cards in your deck can include one color of your choice not in your commander's color identity, and your deck can have any basic land cards.");
  const bolt = card("Lightning Bolt", "Instant", { colorIdentity: ["R"] });
  const char = card("Char", "Instant", { colorIdentity: ["R"] });
  const fire = card("Wrath of God", "Sorcery", { colorIdentity: ["W"] });
  const goblin = card("Goblin Guide", "Creature — Goblin", { colorIdentity: ["R"] });
  expect(identityFinding(plainCmd(["U"]), [bolt, char])!.cards).toEqual(["Char", "Lightning Bolt"]);
  expect(identityFinding(tolabow, [bolt, char, basicIn("Mountain", "R")])).toBeUndefined();
  // two different extra colours among instants/sorceries: not one colour
  expect(identityFinding(tolabow, [bolt, fire])!.cards).toEqual(["Lightning Bolt", "Wrath of God"]);
  // the extra colour does not extend to a creature
  expect(identityFinding(tolabow, [bolt, goblin])!.cards).toEqual(["Goblin Guide"]);
});

// 903.3: "can be your commander" is a legal commander. Corpus texts, 2026-11-19; the code already
// accepted them, so these were green from the start.
test.each([
  ["Ashaya's Enduring Bond", "Legendary Sorcery", "Ashaya's Enduring Bond can be your commander."],
  ["Dyfed, the Guiding Hand", "Legendary Planeswalker — Dyfed", "Dyfed, the Guiding Hand can be your commander."],
  ["Feroz, Ulgrotha's Warden", "Legendary Planeswalker — Feroz", "Feroz, Ulgrotha's Warden can be your commander."],
  ["Greensleeves", "Legendary Planeswalker — Greensleeves", "Greensleeves can be your commander."],
  ["Sifa Grent", "Legendary Planeswalker — Sifa", "Sifa Grent can be your commander."],
])("%s is a legal commander", (name, typeLine, oracleText) => {
  const c = card(name, typeLine, { oracleText, colorIdentity: ["R"] });
  expect(deckLegality({ cards: [c, ...filler(99)], commanders: [c] })).toEqual([]);
});
