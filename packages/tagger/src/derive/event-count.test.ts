import { expect, test } from "vitest";
import { countOf } from "./event-count.js";

const none = undefined;

test("a number or number word is that many, fixed", () => {
  expect(countOf("2", none, "", false)).toEqual({ floor: 2, ceiling: 2 });
  expect(countOf("two", none, "", false)).toEqual({ floor: 2, ceiling: 2 });
  expect(countOf("1", none, "", false)).toEqual({ floor: 1, ceiling: 1 });
});

test("'up to N' has a floor of zero", () => {
  expect(countOf("up to two", none, "", false)).toEqual({ floor: 0, ceiling: 2 });
});

test("X alone is unbounded and scales with mana (Grand Crescendo)", () => {
  expect(countOf("X", none, "", false)).toEqual({ floor: 0, ceiling: null, scalesWith: "mana" });
});

test("'for each <class>' scales with that class (Avenger of Zendikar)", () => {
  expect(countOf("for each land you control", none, "", false))
    .toMatchObject({ floor: 0, ceiling: null, scalesWith: { type: "land", control: "you" } });
});

test("'X, where X is the number of <class>' scales with the class, not mana", () => {
  expect(countOf("X, where X is the number of creatures you control", none, "", false))
    .toMatchObject({ floor: 0, ceiling: null, scalesWith: { type: "creature", control: "you" } });
});

test("a board-wide emit with no amount scales with the emit's own subject (Wrath of God)", () => {
  const emit = { subject: { control: "any" as const, token: null, type: "creature", scope: "all" as const } };
  expect(countOf(undefined, emit, "Destroy all creatures.", false))
    .toEqual({ floor: 0, ceiling: null, scalesWith: emit.subject });
});

test("an amount beats a board scope: Zulaport's 'each opponent loses 1 life' is 1", () => {
  const emit = { subject: { control: "opp" as const, token: null, scope: "each" as const } };
  expect(countOf("1", emit, "each opponent loses 1 life", false)).toEqual({ floor: 1, ceiling: 1 });
});

test("a replacement's 'plus one' is a one-event delta (Hardened Scales)", () => {
  expect(countOf("N+1", none, "that many plus one +1/+1 counters are put on it instead", true)).toEqual({ floor: 1, ceiling: 1 });
});

test("a replacement's 'twice that many' repeats the improved count", () => {
  expect(countOf(undefined, none, "they mill twice that many cards instead", true))
    .toEqual({ floor: 1, ceiling: 1, sameAsImproved: true });
});

test("a damage doubler repeats the improved count too ('deals double the damage')", () => {
  expect(countOf(undefined, none, "it deals double that damage instead", true)).toEqual({ floor: 1, ceiling: 1, sameAsImproved: true });
  expect(countOf(undefined, none, "it deals double the damage instead", true)).toEqual({ floor: 1, ceiling: 1, sameAsImproved: true });
});

test("an emit about the card itself is one event, known", () => {
  expect(countOf(undefined, { subject: { control: "you", token: null, self: true } }, "you may cast this spell", false)).toEqual({ floor: 1, ceiling: 1 });
});

test("anything else records no count", () => {
  expect(countOf("that many", none, "", false)).toBeUndefined();
  expect(countOf(undefined, none, "", false)).toBeUndefined();
  expect(countOf("+1/+1", none, "", false)).toBeUndefined();
});
