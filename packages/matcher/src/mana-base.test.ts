import { expect, test } from "vitest";
import type { Card } from "@edh-seer/engine";
import {
  colourMiss, colourSources, landTarget, manaBaseScore, tappedLandCount, MANA_BASE_COST, SIMULATED_MAX_LANDS, SIMULATED_MIN_LANDS,
  drawCredit,
} from "./mana-base.js";
import type { Color } from "./mana-audit.js";
import type { DeckCard } from "./types.js";

const mk = (name: string, typeLine: string, extra: Partial<Card> = {}): DeckCard => ({
  card: { name, manaValue: 0, oracleText: "", typeLine, keywords: [], colors: [], ...extra } as Card,
  tags: null,
});
const spell = (name: string, manaCost: string, manaValue: number) => mk(name, "Sorcery", { manaCost, manaValue });
const land = (name: string, oracleText: string) => mk(name, "Land", { oracleText });
const sources = (entries: [Color, number][]) => new Map<Color, number>(entries);

const at = (avgManaValue: number, extra: Partial<{ commanderManaValue: number; accelerants: number; drawCredit: number }> = {}) =>
  landTarget({ avgManaValue, commanderManaValue: 0, accelerants: 0, drawCredit: 0, ...extra });

test("the land target reads the curve, the commander, and the ramp and draw package", () => {
  // 27.0 + 3.95 * 3 = 38.85
  expect(at(3)).toBe(39);
  // A 6-mana commander is 3.24 more lands.
  expect(at(3, { commanderManaValue: 6 })).toBe(42);
  // Ten rocks are 5.7 fewer; eight draw cards 2 fewer.
  expect(at(3, { accelerants: 10 })).toBe(33);
  expect(at(3, { drawCredit: 2 })).toBe(37);
});

/** izzet-big-mana: an average of 5.98 asked Karsten for 50 lands, which the old gate answered with
 *  36. The answer is the formula's own, and only past the counts that were ever simulated is it held
 *  at the edge. */
test("a big curve gets a big target, clamped only at the simulated range", () => {
  // 27.0 + 23.6 + 2.7 - 4.6 - 2.0 = 46.8
  expect(at(5.98, { accelerants: 8, drawCredit: 2, commanderManaValue: 5 })).toBe(47);
  expect(at(9, { commanderManaValue: 10 })).toBe(SIMULATED_MAX_LANDS);
  expect(at(0.5, { accelerants: 30 })).toBe(SIMULATED_MIN_LANDS);
});

test("a colour with plenty of sources misses almost nothing, one with three misses almost everything", () => {
  const deck = [spell("Two White", "{1}{W}{W}", 3)];
  expect(colourMiss(deck, sources([["W", 35]]))).toBeLessThan(0.1);
  expect(colourMiss(deck, sources([["W", 3]]))).toBeGreaterThan(0.9);
});

test("a hybrid pip is paid by its better-supplied half, and a Phyrexian pip asks for nothing", () => {
  const hybrid = [spell("Either", "{W/U}", 1)];
  expect(colourMiss(hybrid, sources([["W", 0], ["U", 30]]))).toBeCloseTo(colourMiss([spell("Blue", "{U}", 1)], sources([["U", 30]])), 10);
  expect(colourMiss([spell("Mutagenic", "{G/P}", 1)], sources([]))).toBe(0);
});

test("lands and colourless cards are never a colour miss", () => {
  const deck = [land("Wastes", "{T}: Add {C}."), spell("Rock", "{3}", 3)];
  expect(colourMiss(deck, sources([]))).toBe(0);
});

test("tapped lands: always-tapped and slow fetches count, shocks, checks and commanders do not", () => {
  const deck = [
    land("Guildgate", "This land enters tapped.\n{T}: Add {W} or {U}."),
    land("Evolving Wilds", "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle."),
    land("Hallowed Fountain", "({T}: Add {W} or {U}.)\nAs this land enters, you may pay 2 life. If you don't, it enters tapped."),
    land("Glacial Fortress", "This land enters tapped unless you control a Plains or an Island.\n{T}: Add {W} or {U}."),
    land("Plains", "({T}: Add {W}.)"),
  ];
  expect(tappedLandCount(deck)).toBe(2);
  expect(tappedLandCount(deck, ["Guildgate"])).toBe(1);
});

test("sources are what the goldfish could tap: lands, fetches by what they find, {T}: Add permanents", () => {
  const deck = [
    land("Plains", "({T}: Add {W}.)"),
    land("Evolving Wilds", "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle."),
    mk("Arcane Signet", "Artifact", { oracleText: "{T}: Add one mana of any color in your commander's color identity.", producedMana: ["W", "U"] }),
    // Adds red only on a trigger: `producedMana` names it, and the goldfish could never tap it.
    mk("Birgi", "Legendary Creature", { oracleText: "Whenever you cast a spell, add {R}.", producedMana: ["R"] }),
    // A one-shot is never a source.
    mk("Dark Ritual", "Instant", { oracleText: "Add {B}{B}{B}.", producedMana: ["B"] }),
    mk("Commander Rock", "Artifact", { oracleText: "{T}: Add {U}.", producedMana: ["U"] }),
  ].map((dc) => (dc.card.name === "Plains" ? { ...dc, card: { ...dc.card, typeLine: "Basic Land — Plains", producedMana: ["W"] } } : dc));
  const s = colourSources(deck, ["Commander Rock"]);
  // Plains, the Wilds (it finds the Plains) and the Signet.
  expect(s.get("W")).toBe(3);
  expect(s.get("U")).toBe(1);
  expect(s.get("R")).toBe(0);
  expect(s.get("B")).toBe(0);
});

test("the score is the three parts in one unit, and a short land count costs more than a long one", () => {
  const white = Array.from({ length: 20 }, (_, i) => mk(`Plains ${i}`, "Basic Land — Plains", { oracleText: "({T}: Add {W}.)", producedMana: ["W"] }));
  const deck = [spell("Two White", "{W}{W}", 2), land("Guildgate", "This land enters tapped.\n{T}: Add {W} or {U}."), ...white];
  const short = manaBaseScore(deck, { target: 38, actual: 33 });
  const long = manaBaseScore(deck, { target: 38, actual: 43 });
  expect(short.costs.count).toBeCloseTo(MANA_BASE_COST.short * 25, 1);
  expect(long.costs.count).toBeCloseTo(MANA_BASE_COST.over * 25, 1);
  expect(short.costs.count).toBeGreaterThan(long.costs.count);
  expect(short.tappedLands).toBe(1);
  expect(short.costs.tapped).toBeCloseTo(MANA_BASE_COST.tapped, 2);
  expect(short.total).toBeCloseTo(short.costs.count + short.costs.colour + short.costs.tapped, 2);
  // On target, untapped, every colour there: nothing to pay.
  const perfect = manaBaseScore([spell("One", "{1}", 1)], { target: 36, actual: 36 });
  expect(perfect.total).toBe(0);
});

test("a source's {T}: Add is read per line, and a sacrifice in the cost is not a source", () => {
  const rock = (name: string, oracleText: string) => mk(name, "Artifact", { oracleText, producedMana: ["G"] });
  const s = colourSources([
    rock("Rock", "{T}: Add {G}."),
    rock("Two Lines", "Flying\n{2}, {T}: Add {G}."),
    rock("Sac", "{T}, Sacrifice this artifact: Add {G}."),
    rock("Other Line", "{T}: Draw a card.\nWhenever you cast a spell, add {G}."),
  ]);
  expect(s.get("G")).toBe(2);
});

// Owner, 2026-09-29: cantrips help find lands, a six-mana draw spell does not. Measured in the goldfish.
test("a draw card's credit follows its cost, at half the goldfish rate", () => {
  expect(drawCredit(1)).toBeCloseTo(0.15);
  expect(drawCredit(2)).toBeCloseTo(0.215);
  expect(drawCredit(2)).toBeGreaterThan(drawCredit(4));
  expect(drawCredit(4)).toBeGreaterThan(drawCredit(5));
  expect(drawCredit(7)).toBeLessThan(0);
});
