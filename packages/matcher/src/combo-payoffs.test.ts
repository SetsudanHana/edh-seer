import { expect, test } from "vitest";
import { comboPayoffs, loopEvents } from "./combo-payoffs.js";
import type { DeckCard } from "./types.js";

type Ab = Record<string, unknown>;
const card = (name: string, abilities: Ab[]): DeckCard => ({
  card: { name, manaValue: 2, oracleText: "", typeLine: "Creature", keywords: [], colors: [] },
  tags: { oracleId: name, abilities } as never,
} as DeckCard);
const trig = (verbs: string[], effect: string, subject: Ab = { control: "any", type: "creature" }, extra: Ab = {}): Ab => ({
  kind: "triggered", repeats: "repeatable", trigger: { verbs, subject }, effect: { kind: effect, subject: { control: "opp" } }, ...extra,
});

test("a loop's result text names the events it repeats, and near-infinite counts", () => {
  expect(loopEvents("Infinite death triggers, Infinite creature ETB, Near-infinite lifegain, Infinite colorless mana")).toEqual([
    { verb: "dies", type: "creature" }, { verb: "enters", type: "creature" }, { verb: "gain-life" },
  ]);
  // Leaving is not dying, magecraft is not casting, and a result that names nothing infinite repeats nothing.
  expect(loopEvents("Infinite creature LTB, Infinite magecraft triggers")).toEqual([{ verb: "leaves", type: "creature" }]);
  expect(loopEvents("Win the game")).toEqual([]);
});

const LOOP = { cards: ["Gravecrawler", "Phyrexian Altar"], result: "Infinite death triggers, Infinite creature ETB" };

test("a death payoff elsewhere in the deck turns a death loop into a win", () => {
  const deck = [
    card("Gravecrawler", []), card("Phyrexian Altar", []),
    card("Blood Artist", [trig(["dies"], "player-life-loss")]),
    card("Impact Tremors", [trig(["enters"], "damage")]),
    // Draws a card: not a win, however often it fires.
    card("Grim Haruspex", [trig(["dies"], "draw-card")]),
  ];
  expect(comboPayoffs(deck, LOOP)).toEqual([
    { name: "Blood Artist", on: ["dies"], effect: "player-life-loss" },
    { name: "Impact Tremors", on: ["enters"], effect: "damage" },
  ]);
});

test("the loop's own pieces, capped triggers, opponent-side and token-only triggers are not payoffs", () => {
  const deck = [
    card("Gravecrawler", [trig(["dies"], "player-life-loss")]),
    card("Once Per Turn", [trig(["dies"], "player-life-loss", undefined, { repeats: "per-turn" })]),
    card("Massacre Wurm", [trig(["dies"], "player-life-loss", { control: "opp", type: "creature" })]),
    card("Nadier's Nightblade", [trig(["leaves"], "player-life-loss", { control: "you", token: true })]),
    card("Hurts Yourself", [{ ...trig(["dies"], "player-life-loss"), effect: { kind: "player-life-loss", subject: { control: "you" } } }]),
  ];
  expect(comboPayoffs(deck, { ...LOOP, result: "Infinite death triggers, Infinite creature LTB" })).toEqual([]);
});

/** Aetherflux Reservoir eats a CASTING loop through its own lifegain, then pays the life to win. */
test("a life-to-damage sink is a payoff when the loop, or the sink itself, gains life", () => {
  const aetherflux = card("Aetherflux Reservoir", [
    { kind: "triggered", repeats: "repeatable", trigger: { verbs: ["cast"], subject: { control: "you" } }, effect: { kind: "lifegain" } },
    { kind: "activated", repeats: "repeatable", cost: "Pay 50 life", effect: { kind: "damage", subject: { control: "any" } } },
  ]);
  const hullbreaker = { cards: ["Hullbreaker Horror", "Sol Ring"], result: "Infinite colorless mana, Infinite storm count" };
  expect(comboPayoffs([aetherflux], hullbreaker)).toEqual([{ name: "Aetherflux Reservoir", on: ["cast"], effect: "damage" }]);
  const lifeLoop = { cards: ["A", "B"], result: "Infinite lifegain" };
  expect(comboPayoffs([aetherflux], lifeLoop)).toEqual([{ name: "Aetherflux Reservoir", on: ["gain-life"], effect: "damage" }]);
  // A mana-only loop feeds neither half.
  expect(comboPayoffs([aetherflux], { cards: ["A", "B"], result: "Infinite colorless mana" })).toEqual([]);
});
