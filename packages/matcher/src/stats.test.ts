import { expect, test } from "vitest";
import { parseStat, evalStatPredicate } from "./stats.js";

test("parseStat: pure integer string uses its value", () => {
  expect(parseStat("3")).toBe(3);
  expect(parseStat("0")).toBe(0);
  expect(parseStat("12")).toBe(12);
});

test("parseStat: non-numeric or null reads as 0", () => {
  expect(parseStat("*")).toBe(0);
  expect(parseStat("1+*")).toBe(0);
  expect(parseStat("X")).toBe(0);
  expect(parseStat(null)).toBe(0);
  expect(parseStat(undefined)).toBe(0);
  expect(parseStat("")).toBe(0);
});

test("evalStatPredicate: value comparison", () => {
  const s = { power: 1, toughness: 4, manaValue: 2 };
  expect(evalStatPredicate({ metric: "power", op: "lte", value: 2 }, s)).toBe(true);
  expect(evalStatPredicate({ metric: "power", op: "gt", value: 2 }, s)).toBe(false);
  expect(evalStatPredicate({ metric: "mana-value", op: "eq", value: 2 }, s)).toBe(true);
});

test("evalStatPredicate: relational comparison (metric vs metric)", () => {
  const wall = { power: 0, toughness: 6, manaValue: 3 };
  const beater = { power: 5, toughness: 2, manaValue: 3 };
  expect(evalStatPredicate({ metric: "toughness", op: "gte", vs: "power" }, wall)).toBe(true);
  expect(evalStatPredicate({ metric: "toughness", op: "gte", vs: "power" }, beater)).toBe(false);
});
