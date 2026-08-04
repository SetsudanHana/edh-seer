import { expect, test } from "vitest";
import { classifyEffect } from "./effect-class.js";

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
