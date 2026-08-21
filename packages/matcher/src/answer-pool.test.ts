import { describe, expect, it } from "vitest";
import { POOL_CLASSES, identityKey, loadAnswerPool, poolShare } from "./answer-pool.js";

describe("identityKey", () => {
  it("orders colours WUBRG regardless of input order", () => {
    expect(identityKey(["G", "W", "U"])).toBe("WUG");
    expect(identityKey(["U", "W"])).toBe("WU");
  });
  it("calls the empty identity C, because a JSON key of '' is unreadable", () => {
    expect(identityKey([])).toBe("C");
  });
});

describe("answer-pool.json", () => {
  const pool = loadAnswerPool();

  it("carries all 32 identities and all 6 classes", () => {
    expect(Object.keys(pool)).toHaveLength(32);
    for (const [id, row] of Object.entries(pool)) {
      for (const cls of POOL_CLASSES) {
        expect(row[cls], `${id}.${cls}`).toBeTypeOf("number");
      }
    }
  });

  // THE REAL GUARD, and it needs no database: a card legal in identity I is legal in every
  // SUPERSET of I, so every class count must be monotonically non-decreasing as colours are
  // added. A stale, truncated or half-regenerated artifact breaks this; a correct one cannot.
  it("is monotone under identity superset", () => {
    const COLORS = ["W", "U", "B", "R", "G"];
    for (let m = 0; m < 32; m++) {
      for (let bit = 0; bit < 5; bit++) {
        if (m & (1 << bit)) continue;
        const sub = identityKey(COLORS.filter((_, i) => m & (1 << i)));
        const sup = identityKey(COLORS.filter((_, i) => (m | (1 << bit)) & (1 << i)));
        for (const cls of POOL_CLASSES) {
          expect(pool[sup][cls], `${sup}.${cls} >= ${sub}.${cls}`).toBeGreaterThanOrEqual(pool[sub][cls]);
        }
      }
    }
  });

  it("makes WUBRG the maximum of every class, so poolShare is bounded by 1", () => {
    for (const cls of POOL_CLASSES) {
      const max = Math.max(...Object.values(pool).map((r) => r[cls]));
      expect(pool.WUBRG[cls]).toBe(max);
    }
  });

  it("reproduces the measured mono-black thinness the design argues from", () => {
    expect(pool.B.artifact).toBeLessThan(pool.W.artifact / 3);
    expect(pool.B.creature).toBeGreaterThan(pool.W.creature * 0.9);
  });
});

describe("poolShare", () => {
  it("is 1 for a five-colour deck and small for mono-black artifacts", () => {
    expect(poolShare(["W", "U", "B", "R", "G"], "artifact")).toBe(1);
    expect(poolShare(["B"], "artifact")).toBeLessThan(0.15);
  });
  it("treats an unknown class as fully supplied rather than guessing zero", () => {
    expect(poolShare(["B"], "nonsense")).toBe(1);
  });
});
