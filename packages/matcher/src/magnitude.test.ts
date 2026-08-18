import { expect, test } from "vitest";
import { magnitudeMultipliers, MAGNITUDE_VERBS } from "./magnitude.js";
import type { SupplyDemandRow } from "./supply-demand.js";

const side = (n: number, avail: number) =>
  ({ cards: n, rate: avail, avail, commander: false, refused: 0, tokens: 0, labels: {}, names: [] });

const row = (key: string, supplyAvail: number, demandAvail: number): SupplyDemandRow =>
  ({ key, reasons: 1, supply: side(1, supplyAvail), demand: side(1, demandAvail) });

const OPTS = { glut: 3, beta: 0.5 };

/** The deadband is the whole difference between this curve and a parity-anchored one: at the rate
 *  and avail weightings the MEDIAN row is parity, so a curve anchored at parity would discount
 *  normal deckbuilding in half the population. */
test("a ratio inside the deadband is untouched on both sides", () => {
  const m = magnitudeMultipliers([row("enters:creature", 3, 1)], OPTS);
  expect(m.feeder.get("enters:creature") ?? 1).toBe(1);
  expect(m.payoff.get("enters:creature") ?? 1).toBe(1);
});

test("a glutted shape discounts the FEEDER side only, on min(1, glut/R)^beta", () => {
  const m = magnitudeMultipliers([row("cast:-creature", 53, 1)], OPTS);
  expect(m.feeder.get("cast:-creature")!).toBeCloseTo(Math.sqrt(3 / 53), 6); // ~0.238
  expect(m.payoff.get("cast:-creature") ?? 1).toBe(1);
});

/** The owner's "same the other way around": the mirror exists, even though the measurement says it
 *  fires on only 52 of 1,189 rows after exclusions. */
test("a demand-glutted shape discounts the PAYOFF side only", () => {
  const m = magnitudeMultipliers([row("enters:creature", 1, 12)], OPTS);
  expect(m.payoff.get("enters:creature")!).toBeCloseTo(Math.sqrt(3 / 12), 6); // 0.5
  expect(m.feeder.get("enters:creature") ?? 1).toBe(1);
});

/** 267 of 1,456 rows are 1:N by construction -- one anthem against every creature it buffs, one
 *  tutor against the tribe it finds -- and they carry 156 of the 208 demand-starved rows. A curve
 *  applied to them crushes every anthem in the corpus. */
test("families that are one-to-many by construction are excluded entirely", () => {
  const rows = [row("static:pump", 1, 55), row("tutor:elemental", 1, 43), row("ramp-target:basic", 1, 40)];
  const m = magnitudeMultipliers(rows, OPTS);
  for (const r of rows) {
    expect(m.feeder.get(r.key) ?? 1).toBe(1);
    expect(m.payoff.get(r.key) ?? 1).toBe(1);
  }
});

/** An ALLOW-list, never a reject-list: the next tag family printed must fail SAFE (excluded, so
 *  unscored) rather than fail crushed. This is the FRONT_FACE_ONLY precedent. */
test("an unknown verb family is excluded, not admitted", () => {
  expect(MAGNITUDE_VERBS.has("enters")).toBe(true);
  expect(MAGNITUDE_VERBS.has("static")).toBe(false);
  const m = magnitudeMultipliers([row("newverb:any", 50, 1)], OPTS);
  expect(m.feeder.get("newverb:any") ?? 1).toBe(1);
});

test("beta 0 disables the term for every row", () => {
  const m = magnitudeMultipliers([row("cast:-creature", 53, 1)], { glut: 3, beta: 0 });
  expect(m.feeder.get("cast:-creature") ?? 1).toBe(1);
});
