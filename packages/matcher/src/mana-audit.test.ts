import { expect, test } from "vitest";
import type { Card } from "@mtg/engine";
import { minCopies } from "@mtg/engine";
import { manaAudit, pipsByColor } from "./mana-audit.js";
import { minSources } from "./mulligan.js";
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
  // BOTH ENDS OF THE INTERVAL (roadmap L5). `requiredRaw` is the no-mulligan figure this field held
  // alone until 2026-08-25; `required` prices the free mulligan and is what `met` reads.
  expect(single.requiredRaw).toBe(minCopies(1, 2, 0.9, 100));
  expect(double.requiredRaw).toBe(minCopies(2, 4, 0.9, 100));
  expect(single.required).toBe(minSources(1, 2));
  expect(double.required).toBe(minSources(2, 4));
});

/** Criterion S2: a mulligan cannot make a deck need MORE sources. The clamp in `manaAudit` also has
 *  to hold when the library is short of 99 and the two models are told different deck sizes. */
test("the mulligan-corrected requirement is never higher than the raw one", () => {
  for (const n of [40, 60, 100]) {
    const deck = fillTo(n, [
      card("Doom Blade", "{1}{B}", 2),
      card("Damnation", "{2}{B}{B}", 4),
      card("Turn-one black", "{B}", 1),
      source("Swamp", ["B"]),
    ]);
    for (const d of manaAudit(deck).find((r) => r.color === "B")!.demands) {
      expect(d.required).toBeLessThanOrEqual(d.requiredRaw);
    }
  }
});

/** Criterion S5, and the one case the whole correction is about: a deck holding MORE than the
 *  mulligan-corrected requirement and FEWER than the raw one. `met` anchors on the corrected end, so
 *  the report under-claims a shortfall rather than over-claiming it — anchoring on `requiredRaw`
 *  instead told 62 of the 71 calibration decks they were short by a median of ten sources.
 *
 *  Every other fixture here sits below both ends, so without this one the anchor could be flipped
 *  back and the suite would stay green. */
test("a deck between the two requirements reads MET, not short", () => {
  const between = minSources(2, 3)! + 1;
  expect(between).toBeLessThan(minCopies(2, 3, 0.9, 100));
  const deck = fillTo(100, [
    ...Array.from({ length: 12 }, (_, i) => card(`double-${i}`, "{1}{B}{B}", 3)),
    ...Array.from({ length: between }, (_, i) => source(`Swamp-${i}`, ["B"])),
  ]);
  const black = manaAudit(deck).find((r) => r.color === "B")!;
  expect(black.supplied).toBe(between);
  expect(black.demands.find((d) => d.pips === 2)!.met).toBe(true);
  expect(black.worst).toBeUndefined();
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
    // One under what the CORRECTED requirement asks for, since `met` reads that end -- pinned to
    // the function rather than to a literal so the fixture cannot silently stop testing anything.
    ...Array.from({ length: minSources(2, 3)! - 1 }, (_, i) => source(`Swamp-${i}`, ["B"])),
  ]);
  const black = manaAudit(deck).find((r) => r.color === "B")!;

  expect(black.supplied).toBe(minSources(2, 3)! - 1);
  const worst = black.worst!;
  expect(worst.pips).toBe(2);
  expect(worst.turn).toBe(3);
  expect(worst.cards).toBe(12);
  expect(worst.required).toBe(minSources(2, 3));
  expect(worst.requiredRaw).toBe(minCopies(2, 3, 0.9, 100));
  expect(worst.met).toBe(false);
  expect(worst.required - black.supplied).toBeGreaterThan(0);
});

/** Ranked by SHORTFALL, not by pip count. A double-pip demand on turn 6 can be closer to met than
 *  a single pip on turn 1, and showing the bigger number instead of the bigger gap would point the
 *  reader at the wrong card. */
test("the worst demand is the biggest shortfall, not the most pips", () => {
  const deck = fillTo(100, [
    card("Turn-one black", "{B}", 1),          // 1 pip by T1: the tightest window in the game
    card("Very late double", "{8}{B}{B}", 10), // 2 pips, but ten turns to find them
    // Under BOTH corrected requirements, so both demands are unmet and the ranking has to choose.
    ...Array.from({ length: Math.min(minSources(1, 1)!, minSources(2, 10)!) - 1 }, (_, i) => source(`Swamp-${i}`, ["B"])),
  ]);
  const black = manaAudit(deck).find((r) => r.color === "B")!;
  expect(black.demands.filter((d) => !d.met).length).toBe(2);
  expect(black.worst!.pips).toBe(1);
  expect(black.worst!.turn).toBe(1);
  // The single pip is the bigger gap despite being the smaller demand, and the ranking has to see
  // that: 17 needed against 15, versus 16 against 15.
  expect(minSources(1, 1)).toBe(17);
  expect(minSources(2, 10)).toBe(16);
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

/** The definitional half of the same fix `castability.ts` carries: a ritual adds mana once and is
 *  gone, so it is not a source you can hold to the audit's 90% confidence. Measured over the 71
 *  calibration decks it moved `supplied` on 103 of 153 colour rows. */
test("a one-shot ritual is not a coloured source", () => {
  const ritual = (i: number) => card(`Dark Ritual-${i}`, "{B}", 1, { producedMana: ["B"], typeLine: "Instant" });
  const deck = fillTo(100, [
    card("Damnation", "{2}{B}{B}", 4),
    ...Array.from({ length: 8 }, (_, i) => ritual(i)),
    ...Array.from({ length: 20 }, (_, i) => source(`Swamp-${i}`, ["B"])),
  ]);
  expect(manaAudit(deck).find((r) => r.color === "B")!.supplied).toBe(20);
});

/** …and a mana ROCK still is one: the exclusion is about one-shots, not about nonlands. */
test("a permanent source is still counted", () => {
  const deck = fillTo(100, [
    card("Damnation", "{2}{B}{B}", 4),
    card("Charcoal Diamond", "{2}", 2, { producedMana: ["B"], typeLine: "Artifact" }),
    ...Array.from({ length: 20 }, (_, i) => source(`Swamp-${i}`, ["B"])),
  ]);
  expect(manaAudit(deck).find((r) => r.color === "B")!.supplied).toBe(21);
});
