import { describe, expect, it } from "vitest";
import { scoreStratum, wilson } from "./agreement-core.js";

describe("agreement scoring", () => {
  const key = { "0": "real", "1": "real", "2": "real", "3": "real", "4": "false", "5": "real" };

  it("splits strict from lenient on `partial`, which is what round 3 turned on", () => {
    // 0 agrees, 1 disagrees outright, 2 is partial, 3 agrees. 5 is in the key and UNJUDGED.
    const human = new Map([[0, "true"], [1, "false"], [2, "partial"], [3, "true"]]);
    const s = scoreStratum("real", key, human);
    expect(s.n).toBe(4);
    expect(s.strict).toBe(2);
    expect(s.strictRate).toBeCloseTo(50, 5);
    expect(s.lenientN).toBe(3);
    expect(s.lenient).toBe(1);
    expect(s.lenientRate).toBeCloseTo(33.33, 1);
    expect(s.disagreed).toEqual([1, 2]);
  });

  it("counts a FALSE-stratum row as agreeing only when the owner says false", () => {
    const human = new Map([[4, "false"], [1, "true"]]);
    expect(scoreStratum("false", key, human).strict).toBe(0);
    expect(scoreStratum("false", key, human).n).toBe(1);
  });

  it("reproduces round 3's REAL stratum: 2 of 45 strict, both partial, 0 of 43 lenient", () => {
    const k: Record<string, string> = {};
    const human = new Map<number, string>();
    for (let i = 0; i < 45; i++) {
      k[String(i)] = "real";
      human.set(i, i < 2 ? "partial" : "true");
    }
    const s = scoreStratum("real", k, human);
    expect(s.strictRate).toBeCloseTo(4.4, 1);
    expect(s.lenientN).toBe(43);
    expect(s.lenientRate).toBe(0);
    expect(s.lenientBound[1]).toBeCloseTo(8.2, 1);
  });

  it("has no interval at n = 0", () => expect(wilson(0, 0)).toEqual([0, 0]));
});
