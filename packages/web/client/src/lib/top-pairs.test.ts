import { expect, test } from "vitest";
import type { DeckReport } from "../types.js";
import type { EngineModel, Link, StrongPair } from "./engine-model.js";
import { topPairs } from "./top-pairs.js";

const mv: Record<string, number> = { A: 2, B: 3, C: 1, D: 1, E: 1, F: 1, G: 1, H: 1 };
const link = (text: string): Link => ({ from: "x", to: "y", tag: "t", text, repeat: "static" } as Link);
const sp = (a: string, b: string, ways = ["Draw"], both = false, lines = [link("one"), link("two"), link("three")]): StrongPair =>
  ({ pair: { a, b, links: [], once: false }, ways, both, lines });
const model = (strongest: StrongPair[]) => ({ strongest }) as unknown as EngineModel;
const report = (combos: unknown[]) => ({ combos }) as unknown as DeckReport;
const combo = (cards: string[], extra: object = {}) => ({ cards, result: "Infinite damage", ...extra });
const mvOf = (n: string) => mv[n];
const names = new Map([["a", "A"], ["b", "B"], ["c", "C // Back"], ["d", "D"], ["e", "E"], ["f", "F"]]);
const m = (s: StrongPair[]) => ({ ...model(s), cards: new Map([...names].map(([id, name]) => [id, { id, name }])) }) as unknown as EngineModel;

test("the cheapest two-card combo leads, then the synergy pairs", () => {
  const out = topPairs(report([combo(["A", "B"])]), m([sp("c", "d", ["Draw", "Ramp"], true), sp("e", "f")]), mvOf);
  expect(out.map((p) => p.kind)).toEqual(["combo", "synergy", "synergy"]);
  expect(out[0]).toMatchObject({ kind: "combo", cards: ["A", "B"], manaTogether: 5, kill: "wins by itself" });
  expect(out[1]).toMatchObject({ kind: "synergy", cards: ["C", "D"], ways: ["Draw", "Ramp"], both: true });
});

test("the combo's own pair is not repeated as a synergy", () => {
  const out = topPairs(report([combo(["A", "B"])]), m([sp("b", "a"), sp("c", "d")]), mvOf);
  expect(out.map((p) => p.cards.join("+"))).toEqual(["A+B", "C+D"]);
});

test("no combo gives three synergy pairs, two lines each at most", () => {
  const out = topPairs(report([]), m([sp("a", "b"), sp("c", "d"), sp("e", "f"), sp("a", "f")]), mvOf);
  expect(out).toHaveLength(3);
  expect(out.every((p) => p.kind === "synergy")).toBe(true);
  expect(out[0]!.kind === "synergy" && out[0]!.lines.map((l) => l.text)).toEqual(["one", "two"]);
});

test("a three-piece combo is not a pair", () => {
  expect(topPairs(report([combo(["A", "B", "C"])]), m([]), mvOf)).toEqual([]);
  expect(topPairs(report([combo(["A", "B"], { requires: ["a sac outlet"] })]), m([]), mvOf)).toEqual([]);
});

test("a combo says what wins through it", () => {
  const out = topPairs(report([combo(["A", "B"], { result: "Infinite mana", payoffs: [{ name: "Walking Ballista", on: [], effect: "" }] })]), m([]), mvOf);
  expect(out[0]).toMatchObject({ kind: "combo", kill: "wins through Walking Ballista" });
});

test("an empty model with no combos is empty", () => {
  expect(topPairs(report([]), m([]), mvOf)).toEqual([]);
  expect(topPairs({} as DeckReport, m([]), mvOf)).toEqual([]);
});

test("a long payoff list names two and counts the rest; three are all named", () => {
  const pay = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, on: [], effect: "" }));
  const kill = (n: number) => (topPairs(report([combo(["A", "B"], { result: "Infinite mana", payoffs: pay(n) })]), m([]), mvOf)[0] as { kill: string }).kill;
  expect(kill(3)).toBe("wins through P0, P1 and P2");
  expect(kill(4)).toBe("wins through P0, P1 and 2 more");
  expect(kill(10)).toBe("wins through P0, P1 and 8 more");
});

test("the combo's cards count against the cap of two pairs per card", () => {
  const out = topPairs(report([combo(["A", "B"])]), m([sp("a", "c"), sp("a", "d"), sp("e", "f")]), mvOf);
  expect(out.map((p) => p.cards.join("+"))).toEqual(["A+B", "A+C", "E+F"]);
});
