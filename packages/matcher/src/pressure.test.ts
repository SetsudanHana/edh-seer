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

// --- the mana budget (roadmap L4 / `2026-08-19-clock-and-mana-model-review.md` §3) ---

/** A deck that is NOTHING BUT five-drops, which is what it takes for the budget to bind at all.
 *
 *  A creature costs its mana value times the odds you have drawn it, so ten fatties in a hundred
 *  cards cost six expected mana on turn five and fifteen turns of mana pays for them outright. The
 *  budget is a constraint on decks whose creature count is large against their mana, and the
 *  fixture has to be one of those or it measures nothing -- the first version of this test was a
 *  ten-creature deck and passed in both arms. */
const fatties = (): DeckCard[] =>
  Array.from({ length: 100 }, (_, i) => beater(`fatty-${i}`, "5", 5));

test("without a budget every creature past its own mana value deploys at once", () => {
  // The incumbent behaviour, pinned so the budget arm is measured against something.
  expect(expectedPower(fatties(), 5)).toBeCloseTo(100 * 5 * (12 / 100), 6);
});

test("a mana budget deploys fewer creatures than the deck has drawn", () => {
  // Twelve five-drops expected in hand want sixty mana; 1+2+3+4+5 is fifteen, so a quarter of them
  // are on the board and the rest are stranded in hand -- which is what a real turn five looks like.
  const budgeted = expectedPower(fatties(), 5, { manaBudget: [1, 2, 3, 4, 5] });
  expect(budgeted).toBeLessThan(expectedPower(fatties(), 5));
  expect(budgeted).toBeCloseTo(15 / 5 * 5, 6);
});

test("the budget is cumulative across turns, not per turn", () => {
  // Five mana every turn would cast ONE five-drop a turn if the budget were per-turn; over five
  // turns it is twenty-five mana and five of them, which is what a board built over five turns is.
  expect(expectedPower(fatties(), 5, { manaBudget: [5, 5, 5, 5, 5] })).toBeCloseTo(25 / 5 * 5, 6);
});

test("the last creature the budget can only part-pay for lands part of the time", () => {
  // Ten and a half mana of a deck whose creatures cost 0.6 expected mana each: seventeen and a half
  // of them. Truncating to seventeen would make the curve step, and a step in the curve is a step
  // in the clock.
  expect(expectedPower(fatties(), 5, { manaBudget: [1, 1, 1, 1, 6.5] })).toBeCloseTo(10.5, 6);
});

test("a budget that is never binding reproduces the unbudgeted answer exactly", () => {
  const deck = fatties();
  expect(expectedPower(deck, 5, { manaBudget: [1000, 1000, 1000, 1000, 1000] }))
    .toBe(expectedPower(deck, 5));
});

test("past the simulated turns the budget grows by one land a turn", () => {
  // Holding the last simulated value flat instead would date a slow deck LATE, and a late clock is
  // the one bias in this layer that flatters the deck -- the cascade this item exists to close.
  const deck = fatties();
  const grown = expectedPower(deck, 8, { manaBudget: [1, 2, 3, 4, 5] });
  const clamped = expectedPower(deck, 8, { manaBudget: [1, 2, 3, 4, 5, 5, 5, 5] });
  expect(grown).toBeGreaterThan(clamped);
});

test("a budget makes the clock later, never earlier", () => {
  const deck = fatties();
  const free = measuredClock(deck);
  const paid = measuredClock(deck, { manaBudget: [1, 2, 3, 4, 5, 6, 7, 8] });
  expect(free).toBeDefined();
  expect(paid === undefined || paid >= free!).toBe(true);
});

test("a ramping board casts a creature its turn number cannot pay for", () => {
  // The RAMP half of the cascade. Turn 5 with eight mana on the board really does cast an eight
  // drop, and the incumbent `manaValue <= turn` dated it turn eight -- late, which is the one
  // direction this layer must not be wrong in.
  const deck = fillTo(100, [beater("Titan", "6", 8)]);
  expect(expectedPower(deck, 5)).toBe(0);
  expect(expectedPower(deck, 5, { manaBudget: [1, 2, 4, 6, 8] })).toBeGreaterThan(0);
});

test("a creature is still refused when the board cannot pay for it that turn", () => {
  const deck = fillTo(100, [beater("Titan", "6", 8)]);
  expect(expectedPower(deck, 5, { manaBudget: [1, 2, 3, 4, 5] })).toBe(0);
});
