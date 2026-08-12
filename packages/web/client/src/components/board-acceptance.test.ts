import { describe, expect, it } from "vitest";
import { ACCEPTANCE, FIXTURES } from "./board-acceptance.js";
import { PRESETS } from "./presets.js";

/** The expensive gate is the harness: five fixtures x five presets x ten seeded trials is minutes
 *  of simulation, far too slow to sit in this suite. These tests are the cheap half — they guard
 *  the CAPS TABLE, so the slow gate cannot be silently narrowed. A ratchet nobody runs is
 *  decoration; a ratchet with a missing row is worse, because it looks like coverage. */
describe("the board acceptance table", () => {
  const keys = FIXTURES.flatMap((f) => PRESETS.map((p) => `${f}/${p.label}`));

  it("has a row for every fixture x preset the harness runs", () => {
    expect(keys.filter((k) => !(k in ACCEPTANCE))).toEqual([]);
  });

  it("has no rows the harness does not run", () => {
    // A stale row is a cap protecting nothing, and reads as coverage in a diff.
    expect(Object.keys(ACCEPTANCE).filter((k) => !keys.includes(k))).toEqual([]);
  });

  it("never caps a count below zero", () => {
    for (const [key, cap] of Object.entries(ACCEPTANCE)) {
      for (const [metric, value] of Object.entries(cap)) {
        expect(Number.isInteger(value) && value >= 0, `${key} ${metric} = ${value}`).toBe(true);
      }
    }
  });
});
