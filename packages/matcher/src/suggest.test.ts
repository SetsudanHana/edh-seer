import { expect, test } from "vitest";
import { candidatePool, planList, gapList, answerList, type IndexCard, type DeckSide } from "./suggest.js";

const card = (pos: number, name: string, over: Partial<IndexCard> = {}): IndexCard =>
  ({ pos, name, slug: name.toLowerCase(), identity: ["R"], isLand: false, mv: 3, roles: [], answers: [], ...over });

const index: IndexCard[] = [
  card(0, "Impact Tremors"),
  card(1, "Chaos Warp", { roles: ["targetedRemoval"], answers: ["enchantment", "creature"], mv: 3 }),
  card(2, "Blasphemous Act", { roles: ["boardWipe"], mv: 9 }),
  card(3, "Mountain", { isLand: true, mv: 0 }),
  card(4, "Swords to Plowshares", { identity: ["W"], roles: ["targetedRemoval"], answers: ["creature"], mv: 1 }),
  card(5, "Krenko, Mob Boss"),
  card(6, "Skullclamp", { identity: [], mv: 1 }),
  card(7, "Goblin Bombardment"),
];
const deck = (pi: Record<string, [number, number][]>, names = Object.keys(pi), identity = ["R"]): DeckSide =>
  ({ names: new Set(names), identity: new Set(identity), pi: new Map(Object.entries(pi)) });

test("the pool is the union of the deck's partner lists, deck cards, lands and off-colour cards removed", () => {
  const pool = candidatePool(deck({
    "Krenko, Mob Boss": [[0, 0.3], [3, 0.2], [4, 0.2], [5, 0.9]],
    "Goblin Bombardment": [[0, 0.1], [6, 0.4]],
  }), index);
  expect([...pool.values()].map((c) => c.card.name).sort()).toEqual(["Impact Tremors", "Skullclamp"]);
  expect(pool.get(0)!.connections.map((c) => c.deckCard)).toEqual(["Krenko, Mob Boss", "Goblin Bombardment"]);
});

test("a colourless commander admits only colourless candidates", () => {
  const pool = candidatePool(deck({ "Krenko, Mob Boss": [[0, 0.3], [6, 0.4]] }, ["Krenko, Mob Boss"], []), index);
  expect([...pool.values()].map((c) => c.card.name)).toEqual(["Skullclamp"]);
});

test("a position the index does not have is skipped, not thrown on", () => {
  expect(candidatePool(deck({ "Krenko, Mob Boss": [[999, 0.3], [0, 0.1]] }), index).size).toBe(1);
});

test("a candidate named like a deck card's physical name is already in the deck", () => {
  const pool = candidatePool(deck({ "Goblin Bombardment": [[5, 0.9]] }, ["Goblin Bombardment", "Krenko, Mob Boss"]), index);
  expect(pool.has(5)).toBe(false);
});

test("one deck card listing a candidate twice is one connection", () => {
  const pool = candidatePool(deck({ A: [[0, 0.3], [0, 0.2]] }, ["A"]), index);
  expect(pool.get(0)!.connections).toEqual([{ deckCard: "A", score: 0.3 }]);
});

test("plan list needs two connections and ranks by connections, then score, then lower mana value", () => {
  const pool = candidatePool(deck({
    A: [[0, 0.1], [1, 0.9], [2, 0.5]], B: [[0, 0.1], [2, 0.1]], C: [[1, 0.1]], D: [[6, 0.1]],
  }, ["A", "B", "C", "D"]), index);
  // All three have 2 connections; scores: Chaos Warp 1.0 (A .9 + C .1), Blasphemous Act 0.6, Impact
  // Tremors 0.2. Skullclamp has one connection and is a pair, not a plan.
  expect(planList(pool).map((c) => c.card.name)).toEqual(["Chaos Warp", "Blasphemous Act", "Impact Tremors"]);
});

test("gap list keeps the group's roles, puts the cost band first, and never pads", () => {
  const pool = candidatePool(deck({ A: [[1, 0.1], [2, 0.9]], B: [[2, 0.1]] }, ["A", "B"]), index);
  // Blasphemous Act out-connects Chaos Warp (2 vs 1) but costs 9, outside Interaction's 2-4 band.
  expect(gapList(pool, ["targetedRemoval", "boardWipe"], [2, 4], 5).map((c) => c.card.name))
    .toEqual(["Chaos Warp", "Blasphemous Act"]);
  expect(gapList(pool, ["ramp"], [2, 3], 5)).toEqual([]);
  expect(gapList(pool, ["targetedRemoval", "boardWipe"], [2, 4], 5, new Set([1])).map((c) => c.card.name))
    .toEqual(["Blasphemous Act"]);
});

test("answer list filters on the missing class", () => {
  const pool = candidatePool(deck({ A: [[1, 0.1], [0, 0.9]] }, ["A"]), index);
  expect(answerList(pool, "enchantment", [2, 4], 3).map((c) => c.card.name)).toEqual(["Chaos Warp"]);
  expect(answerList(pool, "planeswalker", [2, 4], 3)).toEqual([]);
});
