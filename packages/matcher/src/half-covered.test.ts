import { expect, test } from "vitest";
import { halfCoveredClasses } from "./half-covered.js";

const row = (cls: string, count: number, fraction?: number, fromCommandZone = false) => ({ cls, count, fraction, fromCommandZone });
const report = (rows: ReturnType<typeof row>[]) => ({
  deckMath: { answers: rows.map((r) => ({ class: r.cls, count: r.count, fromCommandZone: r.fromCommandZone })) },
  answerCoverage: { rows: rows.map((r) => ({ class: r.cls, ...(r.fraction !== undefined ? { fraction: r.fraction } : {}) })) },
});

test("a class with members and a fraction strictly between 0 and 1 is half covered", () => {
  expect(halfCoveredClasses(report([row("enchantment", 1, 0.5)]))).toEqual(["enchantment"]);
});
test("a commander's class, count 0, land, graveyard, full cover and a missing fraction are not", () => {
  expect(halfCoveredClasses(report([
    row("enchantment", 1, 0.5, true), row("artifact", 0, 0.5), row("land", 2, 0.5), row("graveyard", 2, 0.5),
    row("creature", 3, 1), row("planeswalker", 2),
  ]))).toEqual([]);
});
