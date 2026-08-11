import { expect, test } from "vitest";
import type { Card } from "@mtg/engine";
import { minCopies } from "@mtg/engine";
import { manaAudit, pipsByColor } from "./mana-audit.js";
import type { DeckCard } from "./types.js";

const card = (name: string, manaCost: string, manaValue: number, extra: Partial<Card> = {}): DeckCard => ({
  card: { name, manaCost, manaValue, typeLine: "Sorcery", oracleText: "", keywords: [], colors: [] , ...extra } as Card,
  tags: null,
});

const source = (name: string, produces: string[]): DeckCard => ({
  card: {
    name, typeLine: "Land", oracleText: "", keywords: [], colors: [], manaValue: 0,
    producedMana: produces,
  } as Card,
  tags: null,
});

const filler = (i: number) => card(`filler-${i}`, "{1}", 1);
const fillTo = (n: number, deck: DeckCard[]) =>
  [...deck, ...Array.from({ length: n - deck.length }, (_, i) => filler(i))];

test("pips are counted per colour, and generic costs are not pips", () => {
  expect(pipsByColor("{2}{B}{B}")).toEqual({ B: 2 });
  expect(pipsByColor("{W}{U}{B}{R}{G}")).toEqual({ W: 1, U: 1, B: 1, R: 1, G: 1 });
  expect(pipsByColor("{10}")).toEqual({});
  expect(pipsByColor(undefined)).toEqual({});
  // Hybrid and Phyrexian: each can be paid with the colour, so each counts as a demand for it.
  // Overstates a hybrid slightly -- the other half may be payable -- and the audit says so.
  expect(pipsByColor("{B/R}")).toEqual({ B: 1, R: 1 });
  expect(pipsByColor("{B/P}")).toEqual({ B: 1 });
  // X is not a pip, and a colourless cost is not a colour.
  expect(pipsByColor("{X}{C}")).toEqual({});
});

/** The stub's insight, and the reason this is not another Tier C guess: a card's DEADLINE is its
 *  own mana value. You want to cast a 3-drop on turn 3. */
test("a card's deadline is its own mana value", () => {
  const deck = fillTo(100, [
    card("Doom Blade", "{1}{B}", 2),
    card("Damnation", "{2}{B}{B}", 4),
    ...Array.from({ length: 10 }, () => source("Swamp", ["B"])),
  ]);
  const rows = manaAudit(deck);
  const black = rows.find((r) => r.color === "B")!;

  const single = black.demands.find((d) => d.pips === 1)!;
  const double = black.demands.find((d) => d.pips === 2)!;
  expect(single.turn).toBe(2);  // a 2-drop wants its black on turn 2
  expect(double.turn).toBe(4);  // a 4-drop on turn 4, not on some fitted "intended turn"
  expect(single.required).toBe(minCopies(1, 2, 0.9, 100));
  expect(double.required).toBe(minCopies(2, 4, 0.9, 100));
});

test("supply counts every card that can produce the colour, not just lands", () => {
  const deck = fillTo(100, [
    card("Doom Blade", "{1}{B}", 2),
    source("Swamp", ["B"]),
    source("Watery Grave", ["U", "B"]),
    source("Arcane Signet", ["W", "U", "B", "R", "G"]),
    source("Sol Ring", ["C"]), // colorless only: not a black source
  ]);
  const black = manaAudit(deck).find((r) => r.color === "B")!;
  expect(black.supplied).toBe(3);
});

test("the worst unmet demand is the one reported, and it names how many cards want it", () => {
  const deck = fillTo(100, [
    ...Array.from({ length: 12 }, (_, i) => card(`double-${i}`, "{1}{B}{B}", 3)),
    ...Array.from({ length: 4 }, (_, i) => card(`single-${i}`, "{B}", 1)),
    ...Array.from({ length: 26 }, (_, i) => source(`Swamp-${i}`, ["B"])),
  ]);
  const black = manaAudit(deck).find((r) => r.color === "B")!;

  expect(black.supplied).toBe(26);
  const worst = black.worst!;
  expect(worst.pips).toBe(2);
  expect(worst.turn).toBe(3);
  expect(worst.cards).toBe(12);
  expect(worst.required).toBe(minCopies(2, 3, 0.9, 100));
  expect(worst.met).toBe(false);
  expect(worst.required - black.supplied).toBeGreaterThan(0);
});

/** Ranked by SHORTFALL, not by pip count. A double-pip demand on turn 6 can be closer to met than
 *  a single pip on turn 1, and showing the bigger number instead of the bigger gap would point the
 *  reader at the wrong card. */
test("the worst demand is the biggest shortfall, not the most pips", () => {
  const deck = fillTo(100, [
    card("Turn-one black", "{B}", 1),          // 1 pip by T1 wants 25 sources
    card("Very late double", "{8}{B}{B}", 10), // 2 pips, but ten turns to find them: only 20
    ...Array.from({ length: 18 }, (_, i) => source(`Swamp-${i}`, ["B"])),
  ]);
  const black = manaAudit(deck).find((r) => r.color === "B")!;
  expect(black.demands.filter((d) => !d.met).length).toBe(2);
  expect(black.worst!.pips).toBe(1);
  expect(black.worst!.turn).toBe(1);
  // The single pip is the bigger gap despite being the smaller demand, and the ranking has to see
  // that: 25 needed against 18, versus 20 against 18.
  expect(minCopies(1, 1, 0.9, 100)).toBe(25);
  expect(minCopies(2, 10, 0.9, 100)).toBe(20);
});

test("a colour the deck supplies well enough has no worst row", () => {
  const deck = fillTo(100, [
    card("Doom Blade", "{1}{B}", 2),
    ...Array.from({ length: 40 }, (_, i) => source(`Swamp-${i}`, ["B"])),
  ]);
  const black = manaAudit(deck).find((r) => r.color === "B")!;
  expect(black.demands.every((d) => d.met)).toBe(true);
  expect(black.worst).toBeUndefined();
});

test("a colour nothing in the deck costs is not reported at all", () => {
  const deck = fillTo(100, [card("Doom Blade", "{1}{B}", 2), source("Swamp", ["B"])]);
  expect(manaAudit(deck).map((r) => r.color)).toEqual(["B"]);
});

/** The commander is never drawn from the library, so it cannot be a source the maths is counting
 *  -- and `required` is computed against a library that excludes it. Counting it would credit a
 *  source that is not in the deck the hypergeometric describes. */
test("a commander is not counted as a source", () => {
  const deck = fillTo(100, [
    card("Doom Blade", "{1}{B}", 2),
    source("Chromatic Lantern", ["W", "U", "B", "R", "G"]),
    source("Swamp", ["B"]),
  ]);
  const withCommander = manaAudit(deck, { commanderNames: ["Chromatic Lantern"] });
  expect(withCommander.find((r) => r.color === "B")!.supplied).toBe(1);
  expect(manaAudit(deck).find((r) => r.color === "B")!.supplied).toBe(2);
});

test("a card with no mana cost demands nothing", () => {
  const deck = fillTo(100, [source("Swamp", ["B"]), card("Ancestral Vision", "", 0)]);
  expect(manaAudit(deck)).toEqual([]);
});
