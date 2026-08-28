import { expect, test } from "vitest";
import { buildAxis, maxAxisWeight, axisFactor } from "./axis.js";
import type { TagStats } from "@edh-seer/engine";

// 'draw:any' is universal (on ~all N cards → idf≈0); 'dies:creature' is distinctive (rare).
const stats: TagStats = { N: 1000, counts: { "draw:any": 990, "dies:creature": 40 } };

test("a universal tag (idf≈0) drops out; a distinctive tag dominates the axis", () => {
  const deckFreq = new Map([["draw:any", 12], ["dies:creature", 8]]);
  const axis = buildAxis(new Set(), deckFreq, stats);
  expect(axis.get("dies:creature")).toBe(1); // strongest tf-idf → normalized to 1
  expect(axis.get("draw:any") ?? 0).toBeLessThan(0.1); // near-zero, effectively de-noised
});

test("commander tags get a TF boost anchor, still gated by idf", () => {
  const deckFreq = new Map([["dies:creature", 8], ["draw:any", 12]]);
  const boosted = buildAxis(new Set(["dies:creature"]), deckFreq, stats);
  const plain = buildAxis(new Set(), deckFreq, stats);
  expect(boosted.get("dies:creature")! >= plain.get("dies:creature")!).toBe(true);
  // a generic commander tag can't take over: draw:any stays low even if commander-flagged.
  const genericCmd = buildAxis(new Set(["draw:any"]), deckFreq, stats);
  expect(genericCmd.get("draw:any") ?? 0).toBeLessThan(0.5);
});

test("empty/degenerate input yields an empty axis (no divide-by-zero)", () => {
  expect(buildAxis(new Set(), new Map(), stats).size).toBe(0);
  const allUniversal: TagStats = { N: 10, counts: { "draw:any": 10 } }; // idf(draw:any)=log(11/11)=0
  expect(buildAxis(new Set(), new Map([["draw:any", 5]]), allUniversal).size).toBe(0);
});

test("maxAxisWeight returns the strongest reason weight, 0 when none on-axis", () => {
  const axis = new Map([["dies:creature", 1], ["sacrifice:creature", 0.4]]);
  expect(maxAxisWeight([{ tag: "dies:creature" }, { tag: "x" }] as never, axis)).toBe(1);
  expect(maxAxisWeight([{ tag: "unknown" }] as never, axis)).toBe(0);
});

test("axisFactor rides the new weights (1 + boost*maxWeight)", () => {
  const axis = new Map([["dies:creature", 1]]);
  expect(axisFactor([{ tag: "dies:creature" }] as never, axis, 1.5)).toBeCloseTo(2.5);
  expect(axisFactor([{ tag: "x" }] as never, axis, 1.5)).toBe(1);
});
