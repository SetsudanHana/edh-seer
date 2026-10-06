import { expect, test } from "vitest";
import type { CardGraph, DeckReport } from "../types.js";
import { tableTalk } from "./table-talk.js";

const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((turn) => ({ turn, mana: { p25: turn, median: turn, p75: turn + 1 }, payableShare: { p25: 0, median: 0, p75: 0 } }));
function report(over: Partial<{ gameChangers: string[]; band: string; combos: { cards: string[]; result: string; payoffs?: { name: string; on: string[]; effect: string }[] }[]; clock: number; focus: number }> = {}): DeckReport {
  return {
    bracket: { band: over.band ?? "3", gameChangers: over.gameChangers ?? [], infiniteCombos: 0, cheapCombos: [], reasons: [] },
    combos: over.combos ?? [],
    manaAvailability: { trials: 1, accelerants: 0, rows, headline: { mana: 5, turn: 5, low: 0, high: 0 } },
    deckMath: { clock: { turn: over.clock ?? 7, powerAtFive: 5 }, speed: { combat: { turn: (over.clock ?? 7) + 5 } }, wincons: { classes: [{ class: "go-wide", count: 8, share: 0.6, cards: [] }, { class: "burn", count: 4, share: 0.4, cards: [] }], focus: over.focus ?? 0.7 } },
  } as unknown as DeckReport;
}
const graph = (cards: Record<string, string>) => ({ nodes: Object.entries(cards).map(([id, oracleText]) => ({ id, label: id, oracleText, copies: 1, types: [], subtypes: [], supertypes: [], colors: [], cmc: 0 })), edges: [] }) as unknown as CardGraph;
const mv: Record<string, number> = { "Dualcaster Mage": 3, "Essence Flux": 1, A: 3, B: 3, C: 3 };

test("the line says the bracket and why, how it wins and how fast, and what to warn a stranger of", () => {
  const t = tableTalk(report({ gameChangers: ["Rhystic Study"] }), graph({
    Treachery: "Enchant creature. You control enchanted creature.",
    "Time Warp": "Target player takes an extra turn after this one.",
    Armageddon: "Destroy all lands.",
    Bear: "",
  }), (n) => mv[n])!;
  expect(t.text).toBe(
    "Bracket 3, for Rhystic Study (a Game Changer). It wins mostly by attacking with a wide board, or damage or drain, and its creatures can kill the table around turn 12. "
    + "Heads-up: it takes extra turns (Time Warp), steals permanents (Treachery) and can destroy every land (Armageddon).",
  );
});

/** "MOSTLY" ONLY WHEN THE DECK LEANS (persona round 2026-09-27): How you win said "Spread about
 *  evenly across 4 plans" under a table line saying "It wins mostly by …". Same lean test. */
test("a deck spread evenly across its plans is not said to win mostly by one", () => {
  const t = tableTalk(report({ focus: 0.5 }), graph({}), (n) => mv[n])!;
  expect(t.plan).toBe("It spreads its wins across 2 plans: attacking with a wide board and damage or drain, and its creatures can kill the table around turn 12.");
  expect(t.text).not.toMatch(/mostly/);
  // Past three, the rest are counted in the same list: one "and", not two.
  const four = report({ focus: 0.3 });
  (four.deckMath!.wincons.classes as unknown[]).push({ class: "stompy", count: 3, share: 0.1, cards: [] }, { class: "combo", count: 2, share: 0.1, cards: [] });
  expect(tableTalk(four, graph({}), (n) => mv[n])!.plan).toMatch(/^It spreads its wins across 4 plans: attacking with a wide board, damage or drain, attacking with big creatures and 1 more,/);
});

test("a cheap two-card combo is the bracket's reason and the fastest route, and is not repeated as a heads-up", () => {
  const t = tableTalk(report({ band: "4-5", combos: [{ cards: ["Dualcaster Mage", "Essence Flux"], result: "Infinite ETB" }] }), graph({}), (n) => mv[n])!;
  expect(t.bracket).toBe("Bracket 4–5, for a cheap two-card combo (Dualcaster Mage + Essence Flux) that needs another card to win.");
  expect(t.plan).toMatch(/can combo as early as turn 4\.$/);
  expect(t.headsUp).toEqual([]);
  expect(t.text).toMatch(/Beyond that combo, nothing in it takes extra turns, steals or destroys every land\.$/);
});

test("a combo bracket 3 still allows is named as the reason, with why it is allowed", () => {
  const t = tableTalk(report({ combos: [{ cards: ["A", "B", "C"], result: "Infinite mana" }] }), graph({}), (n) => mv[n])!;
  expect(t.bracket).toBe("Bracket 3, for an infinite combo that needs 3 cards (A + B + C) and another card to win.");
});

test("nothing to warn about is said, as what was checked", () => {
  const t = tableTalk(report({ band: "1-2" }), graph({ Bear: "" }), (n) => mv[n])!;
  expect(t.bracket).toBe("Bracket 1–2: no Game Changers and no infinite combo.");
  expect(t.text).toMatch(/Nothing in it takes extra turns, steals, destroys every land or goes infinite\.$/);
});

test("stealing your own permanent back is not stealing", () => {
  const t = tableTalk(report(), graph({ Homeward: "Gain control of target permanent you own." }), (n) => mv[n])!;
  expect(t.headsUp).toEqual([]);
});

/** WHAT KILLS (#1034): the phone seat on Inalla could not tell whether "an infinite combo that needs 3
 *  cards" wins by itself; the Combos page said "Wins through Impact Tremors", a page away. */
test("a combo in the table sentence says what turns it into a win, or that something else must", () => {
  const winning = tableTalk(report({ combos: [{ cards: ["A", "B", "C"], result: "Infinite creature ETB", payoffs: [{ name: "Impact Tremors", on: ["A"], effect: "damage" }] }] }), graph({}), (n) => mv[n])!;
  expect(winning.bracket).toBe("Bracket 3, for an infinite combo that needs 3 cards (A + B + C) and wins through Impact Tremors.");
  const bare = tableTalk(report({ band: "4-5", combos: [{ cards: ["Dualcaster Mage", "Essence Flux"], result: "Infinite ETB" }] }), graph({}), (n) => mv[n])!;
  expect(bare.bracket).toBe("Bracket 4–5, for a cheap two-card combo (Dualcaster Mage + Essence Flux) that needs another card to win.");
});
