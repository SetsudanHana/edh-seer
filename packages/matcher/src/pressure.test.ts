import { expect, test } from "vitest";
import type { Card } from "@mtg/engine";
import { expectedPower, pressureCurve, measuredClock, STARTING_LIFE } from "./pressure.js";
import type { DeckCard } from "./types.js";

const beater = (name: string, power: string, mv: number): DeckCard => ({
  card: { name, typeLine: "Creature — Human", oracleText: "", keywords: [], colors: [], manaValue: mv, power } as Card,
  tags: null,
});

const spell = (name: string, mv = 3): DeckCard => ({
  card: { name, typeLine: "Instant", oracleText: "", keywords: [], colors: [], manaValue: mv } as Card,
  tags: null,
});

const fillTo = (n: number, deck: DeckCard[]) =>
  [...deck, ...Array.from({ length: n - deck.length }, (_, i) => spell(`filler-${i}`))];

test("a creature contributes its power weighted by how likely you have drawn it", () => {
  // One 4-power 2-drop in 100 cards, by turn 5: 12 of 100 cards seen, so 12% of the time it is in
  // hand, and it is castable because its mana value has passed.
  const deck = fillTo(100, [beater("Bear", "4", 2)]);
  expect(expectedPower(deck, 5)).toBeCloseTo(4 * (12 / 100), 6);
});

/** The deadline idea from the mana audit, reused: a card is castable when its own mana value has
 *  arrived. No ramp, so this is conservative, and no colour check, so it is optimistic -- the two
 *  biases are named rather than multiplied together. */
test("a creature you cannot cast yet contributes nothing", () => {
  const deck = fillTo(100, [beater("Colossus", "10", 9)]);
  expect(expectedPower(deck, 3)).toBe(0);
  expect(expectedPower(deck, 9)).toBeGreaterThan(0);
});

test("power that is not a number contributes nothing rather than NaN", () => {
  const deck = fillTo(100, [beater("Goyf", "*", 2), beater("Bear", "2", 2)]);
  // A NaN here would poison the whole curve and every clock derived from it.
  expect(Number.isFinite(expectedPower(deck, 5))).toBe(true);
  expect(expectedPower(deck, 5)).toBeCloseTo(2 * (12 / 100), 6);
});

test("the curve rises with the turn, because you have both drawn and cast more", () => {
  const deck = fillTo(100, Array.from({ length: 20 }, (_, i) => beater(`Bear-${i}`, "3", 2)));
  const curve = pressureCurve(deck);
  const powers = curve.map((c) => c.power);
  expect([...powers].sort((a, b) => a - b)).toEqual(powers);
  expect(curve[0].turn).toBe(1);
});

/** A clock is cumulative: damage dealt on turn 3 does not stop counting on turn 4. Comparing a
 *  single turn's power against 40 would say a deck never wins. */
test("the clock accumulates damage across turns", () => {
  const deck = fillTo(100, Array.from({ length: 40 }, (_, i) => beater(`Bear-${i}`, "5", 1)));
  const curve = pressureCurve(deck);
  expect(curve[3].cumulative).toBeCloseTo(
    curve[0].power + curve[1].power + curve[2].power + curve[3].power, 6,
  );
  const clock = measuredClock(deck);
  expect(clock).toBeGreaterThan(0);
  expect(curve.find((c) => c.turn === clock)!.cumulative).toBeGreaterThanOrEqual(STARTING_LIFE);
});

test("a deck that cannot get there in twenty turns has no clock rather than a made-up one", () => {
  // Nothing but spells: no combat pressure at all, so there is no turn to name and saying "turn 20"
  // would be inventing one.
  expect(measuredClock(fillTo(100, []))).toBeUndefined();
});

test("a faster deck has a shorter clock", () => {
  const fast = fillTo(100, Array.from({ length: 30 }, (_, i) => beater(`Bear-${i}`, "5", 2)));
  const slow = fillTo(100, Array.from({ length: 30 }, (_, i) => beater(`Ogre-${i}`, "3", 5)));
  expect(measuredClock(fast)!).toBeLessThan(measuredClock(slow)!);
});

test("the commander is on the board every game, not drawn", () => {
  const deck = fillTo(100, [beater("Commander", "6", 4), ...Array.from({ length: 10 }, (_, i) => beater(`Bear-${i}`, "2", 2))]);
  const withCmd = pressureCurve(deck, { commanderNames: ["Commander"] });
  const without = pressureCurve(deck);
  // P = 1 rather than 12%, so it contributes its whole 6 power from the turn it is castable.
  expect(withCmd[4].power - without[4].power).toBeGreaterThan(4);
});
