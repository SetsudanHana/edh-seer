import { describe, expect, test } from "vitest";
import { karstenLands } from "./karsten.js";

/** The external spec's §2.1 acceptance cases, recomputed from its own Python before this file was
 *  written: all four reproduce exactly. */
describe("the spec's land-count cases", () => {
  test("reproduces every published arm", () => {
    expect(Math.round(karstenLands({ avgManaValue: 1.8, rampPlusDraw: 15, fastMana: 5 }))).toBe(28); // cEDH turbo
    expect(Math.round(karstenLands({ avgManaValue: 2.0, rampPlusDraw: 12, fastMana: 4 }))).toBe(30); // cEDH lean
    expect(Math.round(karstenLands({ avgManaValue: 3.0, rampPlusDraw: 10, fastMana: 1 }))).toBe(37); // midrange
    expect(Math.round(karstenLands({ avgManaValue: 3.5, rampPlusDraw: 8, fastMana: 1 }))).toBe(39);  // battlecruiser
  });

  /** The term the spec says most implementations get wrong, and the reason `fast-mana` had to come
   *  out of the ramp bucket: a Mox is worth a whole land, cheap ramp is worth a quarter of one. */
  test("fast mana subtracts 1.00 each and cheap ramp 0.28", () => {
    const base = karstenLands({ avgManaValue: 3, rampPlusDraw: 0, fastMana: 0 });
    expect(base - karstenLands({ avgManaValue: 3, rampPlusDraw: 0, fastMana: 1 })).toBeCloseTo(1.0, 10);
    expect(base - karstenLands({ avgManaValue: 3, rampPlusDraw: 1, fastMana: 0 })).toBeCloseTo(0.28, 10);
    // Miscounting one Mox as cheap ramp is worth 0.72 of a land, so five of them is nearly four.
    expect(
      karstenLands({ avgManaValue: 3, rampPlusDraw: 5, fastMana: 0 })
      - karstenLands({ avgManaValue: 3, rampPlusDraw: 0, fastMana: 5 }),
    ).toBeCloseTo(3.6, 10);
  });

  test("MDFCs subtract, untapped ones more than tapped", () => {
    const base = karstenLands({ avgManaValue: 3, rampPlusDraw: 0, fastMana: 0 });
    expect(base - karstenLands({ avgManaValue: 3, rampPlusDraw: 0, fastMana: 0, mdfcUntapped: 1 }))
      .toBeCloseTo(0.74, 10);
    expect(base - karstenLands({ avgManaValue: 3, rampPlusDraw: 0, fastMana: 0, mdfcTapped: 1 }))
      .toBeCloseTo(0.38, 10);
  });

  test("a second commander raises the count", () => {
    expect(karstenLands({ avgManaValue: 3, rampPlusDraw: 10, fastMana: 1, commanders: 2 }))
      .toBeGreaterThan(karstenLands({ avgManaValue: 3, rampPlusDraw: 10, fastMana: 1, commanders: 1 }));
  });

  test("a heavier curve wants more lands", () => {
    const curve = [2, 3, 4].map((avgManaValue) => karstenLands({ avgManaValue, rampPlusDraw: 10, fastMana: 1 }));
    expect([...curve].sort((a, b) => a - b)).toEqual(curve);
  });

  /** The regression is fitted on real decks and has no floor of its own, so a degenerate input can
   *  walk it below zero. A negative land count is not a recommendation. */
  test("never returns a negative count", () => {
    // Raw value here is about -6.6: a 1-drop deck with 40 cheap accelerants and 30 Moxen.
    expect(karstenLands({ avgManaValue: 1, rampPlusDraw: 40, fastMana: 30 })).toBe(0);
    // ...and the floor is not doing the work anywhere realistic: the most degenerate real arm in
    // the spec's own table (cEDH turbo) still wants 28.
    expect(karstenLands({ avgManaValue: 1.8, rampPlusDraw: 15, fastMana: 5 })).toBeGreaterThan(27);
  });
});
