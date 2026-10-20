import { expect, test } from "vitest";
import type { ClauseRecord } from "@edh-seer/tagger";
import { droppedKeys, groupDropped } from "./dropped-clauses-core.js";

const clause = (id: number, ...verbs: string[]): ClauseRecord => ({ id, actions: verbs.map((verb) => ({ verb })) });
const none = { abilityClauses: new Set<number>(), granted: new Set<number>(), hasManaLines: false };

test("a clause with an action and no ability is dropped", () => {
  expect(droppedKeys([clause(0, "gain-life")], none)).toEqual(["0:gain-life"]);
});

test("a clause an ability carries is not dropped", () => {
  expect(droppedKeys([clause(0, "gain-life")], { ...none, abilityClauses: new Set([0]) })).toEqual([]);
});

test("a clause whose only action is inert is not dropped", () => {
  expect(droppedKeys([clause(0, "none")], none)).toEqual([]);
});

test("an inert action beside a real one does not hide the real one", () => {
  expect(droppedKeys([clause(0, "none", "draw")], none)).toEqual(["0:draw"]);
});

test("a mana clause on a card with mana lines is claimed by them", () => {
  expect(droppedKeys([clause(0, "add-mana", "tap")], { ...none, hasManaLines: true })).toEqual([]);
});

test("the same clause on a card with no mana line is a drop", () => {
  expect(droppedKeys([clause(0, "add-mana")], none)).toEqual(["0:add-mana"]);
});

test("a mana-line card's non-mana clause is still a drop", () => {
  expect(droppedKeys([clause(0, "add-mana"), clause(1, "draw")], { ...none, hasManaLines: true })).toEqual(["1:draw"]);
});

test("a clause granted to the card's own token or emblem is not dropped", () => {
  expect(droppedKeys([clause(3, "draw")], { ...none, granted: new Set([3]) })).toEqual([]);
});

test("a zone is part of the key, and keys come back sorted", () => {
  const c: ClauseRecord = { id: 2, actions: [{ verb: "put", fromZone: "library", toZone: "hand" }] };
  expect(droppedKeys([clause(10, "cant"), c], none)).toEqual(["10:cant", "2:put:library>hand"]);
});

test("groups count actions and cards by verb and zone, with examples", () => {
  const g = groupDropped({ A: ["0:cant", "1:cant"], B: ["0:cant", "2:put:library>hand"] });
  expect(g[0]).toEqual({ shape: "cant", actions: 3, cards: 2, examples: ["A", "B"] });
  expect(g[1]).toEqual({ shape: "put library>hand", actions: 1, cards: 1, examples: ["B"] });
});
