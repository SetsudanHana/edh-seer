import { describe, expect, test } from "vitest";
import { classifyGrowth, iterationsNeeded } from "./lines.js";

describe("classifyGrowth", () => {
  // The measured multiplicative family is TINY and fully enumerable: "double" x7, "triple" x2,
  // "twice" x1, "double the number of" x1, "twice that many" x1 out of 2,169 amounts / 310 values.
  test("reads the whole multiplicative lexicon", () => {
    expect(classifyGrowth("double")).toEqual({ kind: "multiplicative", factor: 2 });
    expect(classifyGrowth("Double the number of")).toEqual({ kind: "multiplicative", factor: 2 });
    expect(classifyGrowth("twice that many")).toEqual({ kind: "multiplicative", factor: 2 });
    expect(classifyGrowth("triple")).toEqual({ kind: "multiplicative", factor: 3 });
  });

  // THE FALSE FRIEND, measured in the corpus: "double strike" appears as an `amount` and is a
  // KEYWORD, not a multiplier. Same shape as the thousands-separator bug in the resource ledger.
  test("`double strike` is a keyword, not a multiplier", () => {
    expect(classifyGrowth("double strike")).toEqual({ kind: "unknown" });
  });

  // Shrinking multipliers are not growth toward a threshold. 5 corpus instances.
  test("halving is not growth", () => {
    expect(classifyGrowth("half their life, rounded up")).toEqual({ kind: "unknown" });
    expect(classifyGrowth("half x, rounded down")).toEqual({ kind: "unknown" });
  });

  test("integers are additive, including with a thousands separator", () => {
    expect(classifyGrowth("1")).toEqual({ kind: "additive", step: 1 });
    expect(classifyGrowth("3")).toEqual({ kind: "additive", step: 3 });
    expect(classifyGrowth("1,000")).toEqual({ kind: "additive", step: 1000 });
  });

  test("word numerals are additive", () => {
    expect(classifyGrowth("two")).toEqual({ kind: "additive", step: 2 });
  });

  // 106 abilities carry "x"; 45 carry "that many"/"that much". Refused, never defaulted.
  test("unstated quantities are unknown, not 1", () => {
    expect(classifyGrowth("x")).toEqual({ kind: "unknown" });
    expect(classifyGrowth("that many")).toEqual({ kind: "unknown" });
    expect(classifyGrowth("that much")).toEqual({ kind: "unknown" });
    expect(classifyGrowth(undefined)).toEqual({ kind: "unknown" });
  });

  // A pump amount is a stat change, not a count of a resource.
  test("a P/T amount is not a growth step", () => {
    expect(classifyGrowth("+1/+1")).toEqual({ kind: "unknown" });
    expect(classifyGrowth("-1/-1")).toEqual({ kind: "unknown" });
  });
});

describe("iterationsNeeded", () => {
  // The headline witness. 1,000 time counters doubling from a pessimistic base of 1 is TEN
  // activations -- which is why telling multiplicative from additive is the whole point.
  test("Calendar: 1,000 at x2 from base 1 is 10", () => {
    expect(iterationsNeeded(1000, { kind: "multiplicative", factor: 2 }, 1)).toBe(10);
  });

  // The additive control. 20 growth counters at +1 is 20 fires, and no amount of untapping shortens
  // it. A classifier that ever collapsed the two would fail here.
  test("Simic Ascendancy: 20 at +1 is 20", () => {
    expect(iterationsNeeded(20, { kind: "additive", step: 1 }, 0)).toBe(20);
  });

  test("a base already past the threshold needs no iterations", () => {
    expect(iterationsNeeded(20, { kind: "additive", step: 1 }, 20)).toBe(0);
  });

  test("unknown growth yields no number, rather than a guess", () => {
    expect(iterationsNeeded(1000, { kind: "unknown" }, 1)).toBeUndefined();
  });

  // A multiplicative model needs something to multiply. Zero never grows.
  test("a multiplicative line from base 0 is refused", () => {
    expect(iterationsNeeded(1000, { kind: "multiplicative", factor: 2 }, 0)).toBeUndefined();
  });

  // Factor 3 is IEEE-754-unfriendly: log(9)/log(3) is 2.0000000000000004, not exactly 2, and a bare
  // ceil overcounts by one at every exact power. "triple" is a real 2-instance corpus member, so a
  // silently-wrong iteration count here is exactly the failure mode this file exists to refuse.
  test("factor 3 exact powers do not overcount", () => {
    expect(iterationsNeeded(9, { kind: "multiplicative", factor: 3 }, 1)).toBe(2);
    expect(iterationsNeeded(27, { kind: "multiplicative", factor: 3 }, 1)).toBe(3);
    expect(iterationsNeeded(81, { kind: "multiplicative", factor: 3 }, 1)).toBe(4);
  });

  // A non-power proves the float-snap doesn't over-round: 3^2=9 < 10 <= 3^3=27, so 3 iterations,
  // not 2.
  test("factor 3 non-power still rounds up correctly", () => {
    expect(iterationsNeeded(10, { kind: "multiplicative", factor: 3 }, 1)).toBe(3);
  });

  // Factor 2 exact powers are the ones the brief's spot-checks already covered and must not regress.
  test("factor 2 exact powers are unaffected", () => {
    expect(iterationsNeeded(8, { kind: "multiplicative", factor: 2 }, 1)).toBe(3);
    expect(iterationsNeeded(1024, { kind: "multiplicative", factor: 2 }, 1)).toBe(10);
  });

  // The headline witness, re-asserted after the fix.
  test("Calendar still holds after the fix", () => {
    expect(iterationsNeeded(1000, { kind: "multiplicative", factor: 2 }, 1)).toBe(10);
  });

  // A non-1 base landing exactly on a power: 3^2 x 3 = 27.
  test("a non-1 base at an exact power", () => {
    expect(iterationsNeeded(27, { kind: "multiplicative", factor: 3 }, 3)).toBe(2);
  });
});
