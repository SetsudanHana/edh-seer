import { expect, test } from "vitest";
import type { Card, Combo } from "@edh-seer/engine";
import { bandAfter, bringDown, fitsTarget, gameChangerLimit } from "./bracket-guard.js";

const card = (name: string, manaValue: number, gameChanger?: boolean): Card => ({
  name, typeLine: "Artifact", oracleText: "", keywords: [], colors: [], manaValue,
  ...(gameChanger !== undefined ? { gameChanger } : {}),
} as Card);
const combo = (cards: string[], result = "Infinite mana", requires?: string[]): Combo => ({ cards, result, ...(requires ? { requires } : {}) });
const noLinks = new Map<string, number>();

test("the band after swaps is deckBracket's on the deck the swaps leave", () => {
  const deck = [card("Commander", 3), card("Bear", 2), card("Rock", 2)];
  expect(bandAfter(deck, [], [], []).band).toBe("1-2");
  expect(bandAfter(deck, [], ["Bear"], [card("Rhystic Study", 3, true)]).band).toBe("3");
});

test("an add that completes a combo moves the band, and cutting a piece breaks it", () => {
  const deck = [card("Commander", 3), card("Dramatic Reversal", 2), card("Bear", 2)];
  const combos = [combo(["Dramatic Reversal", "Isochron Scepter"])];
  expect(fitsTarget(deck, combos, [], [card("Isochron Scepter", 2)], 3)).toBe(false);
  expect(fitsTarget(deck, combos, ["Dramatic Reversal"], [card("Isochron Scepter", 2)], 2)).toBe(true);
  expect(fitsTarget(deck, combos, [], [card("Isochron Scepter", 2)], 4)).toBe(true);
});

test("target 3 allows three Game Changers and target 2 none", () => {
  expect(gameChangerLimit(2)).toBe(0);
  expect(gameChangerLimit(3)).toBe(3);
  expect(gameChangerLimit(4)).toBe(Infinity);
});

test("a deck already under the target needs no cuts", () => {
  expect(bringDown([card("Commander", 3), card("Bear", 2)], [], 2, ["Commander"], noLinks)).toEqual({ cuts: [], reachable: true });
});

test("bring-down cuts the least-linked Game Changers over the limit, never the commander", () => {
  const deck = [card("Commander", 3), card("Cyclonic Rift", 2, true), card("Smothering Tithe", 4, true), card("Bear", 2)];
  const links = new Map([["Cyclonic Rift", 9], ["Smothering Tithe", 2]]);
  const two = bringDown(deck, [], 2, ["Commander"], links);
  expect(two.cuts.map((c) => c.name)).toEqual(["Smothering Tithe", "Cyclonic Rift"]);
  expect(two.cuts[0]!.why).toEqual({ kind: "game-changer", limit: 0, count: 2 });
  expect(two.reachable).toBe(true);
  expect(bringDown(deck, [], 3, ["Commander"], links).cuts).toEqual([]);
});

test("a commander that is itself a Game Changer cannot be brought to bracket 2", () => {
  const deck = [card("Commander", 3, true), card("Bear", 2)];
  expect(bringDown(deck, [], 2, ["Commander"], noLinks)).toEqual({ cuts: [], reachable: false });
});

test("bracket 2 breaks every infinite combo; bracket 3 only the cheap two-piece ones", () => {
  const deck = [card("Commander", 3), card("A", 2), card("B", 2), card("C", 5), card("D", 5), card("E", 1)];
  const combos = [combo(["A", "B"]), combo(["C", "D"]), combo(["A", "E"], "Infinite mana", ["Creature with undying"])];
  const three = bringDown(deck, combos, 3, ["Commander"], noLinks);
  expect(three.cuts.map((c) => c.name)).toEqual(["A"]);
  expect(three.cuts[0]!.why).toEqual({ kind: "combo", with: ["B"], result: "Infinite mana" });
  // A breaks two of the three at once (A+B and A+E), so it goes first; C+D needs one more.
  const two = bringDown(deck, combos, 2, ["Commander"], noLinks);
  expect(two.cuts.map((c) => c.name)).toEqual(["A", "C"]);
  expect(two.reachable).toBe(true);
});

test("a combo's cut is the piece with fewer links, and a commander piece is never the cut", () => {
  const deck = [card("Commander", 3), card("A", 2), card("B", 2)];
  const links = new Map([["A", 20], ["B", 3]]);
  expect(bringDown(deck, [combo(["A", "B"])], 3, ["Commander"], links).cuts.map((c) => c.name)).toEqual(["B"]);
  expect(bringDown(deck, [combo(["Commander", "A"])], 3, ["Commander"], links).cuts.map((c) => c.name)).toEqual(["A"]);
});

test("a finite combo is never a reason to cut", () => {
  const deck = [card("Commander", 3), card("A", 2), card("B", 2)];
  expect(bringDown(deck, [combo(["A", "B"], "Lock")], 2, ["Commander"], noLinks).cuts).toEqual([]);
});

test("a forbidden combo of commanders alone is unreachable", () => {
  const deck = [card("Partner A", 2), card("Partner B", 2)];
  expect(bringDown(deck, [combo(["Partner A", "Partner B"])], 3, ["Partner A", "Partner B"], noLinks).reachable).toBe(false);
});

test("a Game Changer cut for a combo counts toward the limit", () => {
  const deck = [card("Commander", 3), card("Thassa's Oracle", 2, true), card("Demonic Consultation", 1, true)];
  const links = new Map([["Thassa's Oracle", 1], ["Demonic Consultation", 5]]);
  const two = bringDown(deck, [combo(["Thassa's Oracle", "Demonic Consultation"], "Infinite... Win the game")], 2, ["Commander"], links);
  expect(two.cuts.map((c) => c.name)).toEqual(["Thassa's Oracle", "Demonic Consultation"]);
  expect(two.cuts.map((c) => c.why.kind)).toEqual(["combo", "game-changer"]);
});
