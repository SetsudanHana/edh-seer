import { expect, test } from "vitest";
import type { ClauseRecord } from "@edh-seer/tagger";
import { droppedKeys, groupDropped, groupSplit, splitReported } from "./dropped-clauses-core.js";

const clause = (id: number, ...verbs: string[]): ClauseRecord => ({ id, actions: verbs.map((verb) => ({ verb })) });
const none = { abilityClauses: new Set<number>(), granted: new Set<number>(), hasManaLines: false, spliced: new Set<number | string>(), isLand: true, texts: {} as Record<number, string>, cardName: "Card" };

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

test("a dropped action is REPORTED when derive's `unclaimed` names its clause, else SILENT", () => {
  const m = { A: ["0:cant", "1:draw"], B: ["3:cant"] };
  const { reported, silent } = splitReported(m, { A: new Set(["1"]) });
  expect(reported).toEqual({ A: ["1:draw"] });
  expect(silent).toEqual({ A: ["0:cant"], B: ["3:cant"] });
});

test("a clause id of 10 is not reported by an unclaimed entry for clause 1", () => {
  expect(splitReported({ A: ["10:cant"] }, { A: new Set(["1"]) }).silent).toEqual({ A: ["10:cant"] });
});

test("the split table counts reported and silent actions per shape", () => {
  const g = groupSplit({ A: ["0:cant", "1:cant"], B: ["0:cant", "2:put:library>hand"] }, { A: new Set(["1"]), B: new Set(["2"]) });
  expect(g[0]).toEqual({ shape: "cant", actions: 3, reported: 1, silent: 2, cards: 2, examples: ["A", "B"] });
  expect(g[1]).toEqual({ shape: "put library>hand", actions: 1, reported: 1, silent: 0, cards: 1, examples: ["B"] });
});

test("a mixed clause (add-mana + draw) on a mana-line card stays a drop", () => {
  expect(droppedKeys([clause(0, "add-mana", "draw")], { ...none, hasManaLines: true })).toEqual(["0:add-mana", "0:draw"]);
});

test("a tap-only clause on a mana-line card stays a drop", () => {
  expect(droppedKeys([clause(0, "tap")], { ...none, hasManaLines: true })).toEqual(["0:tap"]);
});

test("an action with no verb is real, as in derive, not inert", () => {
  expect(droppedKeys([{ id: 0, actions: [{}] }], none)).toEqual(["0:?"]);
});

test("a clause derive spliced into its twin is not dropped; one it did not is", () => {
  expect(droppedKeys([clause(2, "draw")], { ...none, spliced: new Set([2]) })).toEqual([]);
  expect(droppedKeys([clause(2, "draw")], none)).toEqual(["2:draw"]);
});

const tapped = (id: number, object: string): ClauseRecord => ({ id, actions: [{ verb: "tap", object }] });

test("a self enters-tapped clause is excluded", () => {
  expect(droppedKeys([tapped(0, "this land")], { ...none, texts: { 0: "This land enters tapped unless you control a Mountain." } })).toEqual([]);
  expect(droppedKeys([tapped(0, "Card")], { ...none, texts: { 0: "Card enters the battlefield tapped." } })).toEqual([]);
});

test("tap target creature is kept", () => {
  expect(droppedKeys([tapped(0, "target creature")], { ...none, texts: { 0: "Tap target creature." } })).toEqual(["0:tap"]);
});

test("a cost-like tap of your own creatures is kept", () => {
  expect(droppedKeys([tapped(0, "an untapped creature you control")], { ...none, texts: { 0: "Tap an untapped creature you control: draw." } })).toEqual(["0:tap"]);
});

test("a global 'each creature enters tapped' labelled this stays a drop", () => {
  const h = { ...none, hasManaLines: true, texts: { 0: "Each creature without mana value of the chosen quality enters tapped." } };
  expect(droppedKeys([tapped(0, "this")], h)).toEqual(["0:tap"]);
});

test("a self enters-tapped on a non-land card with no mana line stays a drop", () => {
  expect(droppedKeys([tapped(0, "this creature")], { ...none, isLand: false, texts: { 0: "This creature enters tapped." } })).toEqual(["0:tap"]);
});

test("a mana rock's self enters-tapped is excluded, and a DFC front-face name opens it", () => {
  expect(droppedKeys([tapped(0, "this artifact")], { ...none, isLand: false, hasManaLines: true, texts: { 0: "This artifact enters tapped." } })).toEqual([]);
  expect(droppedKeys([tapped(0, "Front")], { ...none, cardName: "Front // Back", texts: { 0: "Front enters tapped." } })).toEqual([]);
});

test("a legend's short name before the comma is a self subject", () => {
  expect(droppedKeys([tapped(0, "this")], { ...none, cardName: "Boseiju, Who Shelters All", texts: { 0: "Boseiju enters tapped." } })).toEqual([]);
});
