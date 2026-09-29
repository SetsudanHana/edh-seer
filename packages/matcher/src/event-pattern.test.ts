import { expect, test } from "vitest";
import { identityMask } from "./partners-core.js";
import { baseOf, eventPatterns, patternFrequency, isPattern, narrowingOf, narrowingsOf, patternsOf, supplyKeyOf } from "./event-pattern.js";

test("a pattern is a key with an open slot; the base pattern opens all three", () => {
  expect(isPattern("dies|*|*|*")).toBe(true);
  expect(isPattern("dies|creature|*|*")).toBe(true);
  expect(isPattern("dies|creature|-|-")).toBe(false);
  expect(baseOf("dies|creature|goblin|n")).toBe("dies|*|*|*");
});

test("a pattern reads in the engine's own spelling with its open slots as '-'", () => {
  expect(supplyKeyOf("dies|*|*|*")).toBe("dies|-|-|-");
  expect(supplyKeyOf("sacrifice|*|*|t")).toBe("sacrifice|-|-|t");
  expect(supplyKeyOf("dies|creature|-|-")).toBe("dies|creature|-|-");
});

test("a pattern says what it narrows to", () => {
  expect(narrowingOf("dies|*|*|*")).toBeNull();
  expect(narrowingOf("dies|creature|*|*")).toEqual({ slot: "type", value: "creature" });
  expect(narrowingOf("enters|*|wizard|*")).toEqual({ slot: "subtype", value: "wizard" });
  expect(narrowingOf("sacrifice|*|*|t")).toEqual({ slot: "token", value: "t" });
  expect(narrowingOf("dies|creature|-|-")).toBeNull();
});

test("a demand belongs to its verb's base and to every target it names, a list to each member", () => {
  expect(patternsOf("dies|creature|goblin|n")).toEqual(["dies|*|*|*", "dies|creature|*|*", "dies|*|goblin|*", "dies|*|*|n"]);
  expect(patternsOf("enters|artifact,creature|-|-")).toEqual(["enters|*|*|*", "enters|artifact|*|*", "enters|creature|*|*"]);
  expect(patternsOf("gain-life|-|-|-")).toEqual(["gain-life|*|*|*"]);
});

test("both sides of a pattern are unions of the keys it covers; makers keep the index's order", () => {
  const events = new Map([
    ["dies|creature|-|-", { p: [9, 2], c: [3, 1] }],
    ["dies|-|goblin|-", { p: [], c: [1, 7] }],
    // The supply form the base reads as, in "how much it does" order: 8 before 2.
    ["dies|-|-|-", { p: [8, 2], c: [5] }],
    ["draw|-|-|-", { p: [4], c: [] }],
    ["dies|*|*|*", { p: [], c: [99] }],
  ]);
  const out = eventPatterns(events);
  expect(out.get("dies|*|*|*")).toEqual({ p: [8, 2, 9], c: [1, 3, 5, 7] });
  expect(out.get("dies|creature|*|*")).toEqual({ p: [9, 2], c: [1, 3] });
  expect(out.get("dies|*|goblin|*")).toEqual({ p: [], c: [1, 7] });
  // Drawing is made and never asked for: the pattern still answers the makes side.
  expect(out.get("draw|*|*|*")).toEqual({ p: [4], c: [] });
  // A pattern already in the index is never read as a source.
  expect(out.get("dies|*|*|*")!.c).not.toContain(99);
});

test("a verb's narrowings come from keys with exactly one target, once each", () => {
  const keys = ["dies|creature|-|-", "dies|-|goblin|-", "dies|-|-|t", "dies|creature|goblin|-", "dies|-|-|-",
    "dies|creature|*|*", "dies|artifact,creature|-|-", "enters|land|-|-"];
  expect(narrowingsOf("dies", keys).sort()).toEqual(["dies|*|*|t", "dies|*|goblin|*", "dies|creature|*|*"]);
});

test("a pattern's counts are its makers and pay-offs, the makers split by colour identity", () => {
  const identities: Record<number, string[]> = { 1: ["B"], 2: ["B"], 3: ["U", "B"] };
  const f = patternFrequency(new Map([["dies|*|*|*", { p: [1, 2, 3], c: [3] }], ["draw|*|*|*", { p: [], c: [2] }]]), (i) => identities[i] ?? []);
  expect(f.supply).toEqual({ "dies|*|*|*": 3 });
  expect(f.consume).toEqual({ "dies|*|*|*": 1, "draw|*|*|*": 1 });
  expect(f.byIdentity["dies|*|*|*"]![identityMask(["B"])]).toBe(2);
  expect(f.byIdentity["dies|*|*|*"]![identityMask(["U", "B"])]).toBe(1);
});
