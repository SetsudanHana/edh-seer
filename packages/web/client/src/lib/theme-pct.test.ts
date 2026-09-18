import { describe, expect, test } from "vitest";
import { themePct, themePct1 } from "./theme-pct.js";

describe("themePct", () => {
  /** THE DEFECT THIS EXISTS TO STOP (UX sweep 2026-09-06, D4): 0.249 must never print as 25%, which
   *  is the floor the template compares it against. Rounding put the figure on the wrong side. */
  test("floors rather than rounding, so a theme never reads above a floor it missed", () => {
    expect(themePct(0.249)).toBe(24);
    expect(themePct(0.2499)).toBe(24);
    expect(themePct(0.25)).toBe(25);
  });

  /** AND THE DRIFT THAT PERSONA ROUND 2 FOUND (2026-09-18): `DeckIdentity` used `Math.round` on the
   *  same field `ArchetypeBoard` floored, so Glance read 34% / 21% where the Plan bars read 33% / 20%
   *  on the same deck. One function, so the two surfaces cannot disagree again. */
  test("the values that printed differently on two surfaces now agree", () => {
    for (const c of [0.339, 0.209, 0.355, 0.169, 0.129]) {
      expect(themePct(c)).toBe(Math.floor(c * 100));
      expect(themePct(c)).not.toBe(Math.round(c * 100));
    }
  });

  test("handles the ends", () => {
    expect(themePct(0)).toBe(0);
    expect(themePct(1)).toBe(100);
  });
});

describe("themePct1", () => {
  test("floors to one decimal", () => {
    expect(themePct1(0.2499)).toBe("24.9");
    expect(themePct1(0.25)).toBe("25.0");
    expect(themePct1(0.1)).toBe("10.0");
  });
});
