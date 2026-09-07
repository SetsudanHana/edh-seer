import { expect, test } from "vitest";
import { EFFECT_KINDS } from "@edh-seer/tagger";
import { classifyEffect, CONTINUOUS, REPLACEMENT } from "./effect-class.js";
import { CONSISTENCY_KINDS, EFFICIENCY_KINDS, WIN_CONDITION_KINDS } from "./buckets.js";

test("set modifiers are continuous", () => {
  for (const k of ["pump", "cost-reduction", "tax", "speed-increase", "animate"]) {
    expect(classifyEffect(k, false), k).toBe("continuous");
  }
});

test("event modifiers are replacement", () => {
  for (const k of ["trigger-doubling", "token-doubling", "clone", "enters-with-counters", "counter-placement"]) {
    expect(classifyEffect(k, false), k).toBe("replacement");
  }
});

test("damage-multiplier splits on the stat predicate", () => {
  // Pyromancer's Gauntlet: "would deal damage ... deals that much damage plus 2"
  expect(classifyEffect("damage-multiplier", false)).toBe("replacement");
  // Felothar / Assault Formation: "assigns combat damage equal to its toughness"
  expect(classifyEffect("damage-multiplier", true)).toBe("continuous");
});

test("kinds outside the corpus census are unclassified, not guessed", () => {
  expect(classifyEffect("drain", false)).toBe("unclassified");
  expect(classifyEffect("not-a-real-kind", false)).toBe("unclassified");
});

/** `EFFECT_KINDS` is a const ARRAY and every one of these collections is a `Set<string>`, so `tsc`
 *  CANNOT see a kind that no longer exists. That is exactly how `top-manipulation` could have been
 *  left behind in five files on 2026-09-07 with a green typecheck and a green suite -- the readers
 *  would have kept a dead name and quietly stopped matching anything, which is a silent wrong
 *  answer, the failure this repo ranks worst.
 *
 *  Same shape as `otags/semantics.test.ts`, which already pins every otag's `effectKind` this way,
 *  and as `sentence.test.ts`, which pins `VERB_PHRASES` against `VERB_VOCAB`. A kind-keyed
 *  collection that nothing validates is a stale string waiting to happen, and a stale artifact is
 *  this repo's most-repeated defect: `hierarchy.json` at 16 of 527 subtypes, `theme-stats.json`
 *  eight PRs behind, and this. */
test("every kind-keyed collection names only real EFFECT_KINDS members", () => {
  const kinds = new Set<string>(EFFECT_KINDS as readonly string[]);
  for (const [label, set] of [
    ["CONSISTENCY_KINDS", CONSISTENCY_KINDS], ["EFFICIENCY_KINDS", EFFICIENCY_KINDS],
    ["WIN_CONDITION_KINDS", WIN_CONDITION_KINDS], ["CONTINUOUS", CONTINUOUS],
    ["REPLACEMENT", REPLACEMENT],
  ] as const) {
    expect([...set].filter((k) => !kinds.has(k)), label).toEqual([]);
  }
});
