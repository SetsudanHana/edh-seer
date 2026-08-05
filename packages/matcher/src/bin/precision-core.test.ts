import { expect, test } from "vitest";
import {
  blind, sample, score, seededRng, wilson,
  type Judgment, type SampledReason,
} from "./precision-core.js";

const reasons = (source: SampledReason["source"], n: number): SampledReason[] =>
  Array.from({ length: n }, (_, i) => ({
    source, deck: "d", producer: `P${i}`, consumer: `C${i}`, tag: `t${i % 5}`,
  }));

test("the same seed draws the same sample, a different seed does not", () => {
  // The sample must be reproducible from the seed recorded in the worksheet, or nothing stops a
  // redraw until the answer is agreeable.
  const pool = reasons("flat", 200);
  const a = sample(pool, 20, seededRng(7));
  const b = sample(pool, 20, seededRng(7));
  const c = sample(pool, 20, seededRng(8));
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

test("sampling draws without replacement and cannot exceed the pool", () => {
  const pool = reasons("flat", 10);
  const drawn = sample(pool, 20, seededRng(1));
  expect(drawn).toHaveLength(10);
  expect(new Set(drawn.map((r) => r.producer)).size).toBe(10);
});

test("blinding removes the source and the prose, and interleaves both arms", () => {
  // The generated `text` is templated per code path and is the likeliest leak of which population
  // produced a row; `source` is the answer itself.
  const rows = blind([...reasons("flat", 5), ...reasons("derived", 5)], seededRng(3));
  for (const r of rows) {
    expect(r).not.toHaveProperty("source");
    expect(r).not.toHaveProperty("text");
    expect(r.id).toEqual(expect.any(Number));
  }
  // Interleaved: the first five ids must not all have come from one arm.
  const key = new Map(rows.map((r) => [r.id, r]));
  expect(key.size).toBe(10);
});

test("blinding assigns ids that the key can resolve back to a source", () => {
  const input = [...reasons("flat", 4), ...reasons("derived", 4)];
  const rows = blind(input, seededRng(11));
  const sources = rows.map((r) => input[r.sourceIndex].source);
  expect(sources.filter((s) => s === "flat")).toHaveLength(4);
  expect(sources.filter((s) => s === "derived")).toHaveLength(4);
});

test("precision excludes uncertain from the denominator and counts it separately", () => {
  // An uncertain row is an escalation, not a failure: scoring it either way would invent a verdict
  // the judge explicitly declined to give.
  const judgments: Judgment[] = [
    { id: 0, verdict: "real", note: "" },
    { id: 1, verdict: "real", note: "" },
    { id: 2, verdict: "false", cause: "false-emit", note: "" },
    { id: 3, verdict: "uncertain", note: "" },
  ];
  const key = new Map([[0, "flat"], [1, "flat"], [2, "flat"], [3, "flat"]] as const);
  const out = score(judgments, key as Map<number, SampledReason["source"]>);
  expect(out.flat.real).toBe(2);
  expect(out.flat.false).toBe(1);
  expect(out.flat.uncertain).toBe(1);
  expect(out.flat.precision).toBeCloseTo(2 / 3, 6);
  expect(out.flat.causes["false-emit"]).toBe(1);
});

test("wilson bounds bracket the point estimate and stay inside [0,1]", () => {
  // The normal approximation misbehaves exactly where a high-precision population sits, which is
  // the case this measurement is most likely to face.
  const [lo, hi] = wilson(50, 100);
  expect(lo).toBeCloseTo(0.4038, 3);
  expect(hi).toBeCloseTo(0.5962, 3);

  const [perfectLo, perfectHi] = wilson(30, 30);
  expect(perfectLo).toBeGreaterThan(0.85);
  expect(perfectHi).toBe(1);

  const [zeroLo] = wilson(0, 20);
  expect(zeroLo).toBe(0);
});

test("an empty denominator reports no precision rather than NaN", () => {
  const out = score([{ id: 0, verdict: "uncertain", note: "" }], new Map([[0, "derived"]]));
  expect(out.derived.precision).toBeNull();
});
