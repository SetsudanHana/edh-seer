import { describe, expect, it } from "vitest";
import { FIXTURES, QUALITY_CAPS } from "./board-quality.js";

/** The expensive gate is the harness -- five fixtures x ten seeded trials is minutes of
 *  simulation, too slow for this suite. These are the cheap half: they guard the CAPS TABLE, so
 *  the slow gate cannot be silently narrowed. A ratchet nobody runs is decoration; a ratchet with
 *  a missing row is worse, because it reads as coverage in a diff. */
describe("the board quality table", () => {
  it("has a row for every fixture the harness runs", () => {
    expect(FIXTURES.filter((f) => !(f in QUALITY_CAPS))).toEqual([]);
  });

  it("has no rows the harness does not run", () => {
    expect(Object.keys(QUALITY_CAPS).filter((k) => !FIXTURES.includes(k))).toEqual([]);
  });

  it("never caps a count below zero", () => {
    for (const [key, cap] of Object.entries(QUALITY_CAPS)) {
      for (const [metric, value] of Object.entries(cap)) {
        expect(Number.isInteger(value) && value >= 0, `${key} ${metric} = ${value}`).toBe(true);
      }
    }
  });

  it("caps node overlap at zero everywhere -- it is the hard condition", () => {
    for (const [key, cap] of Object.entries(QUALITY_CAPS)) {
      expect(cap.nodeOverlaps, key).toBe(0);
    }
  });
});
