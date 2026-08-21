import { expect, test } from "vitest";
import { deckSentence } from "./deck-sentence.js";
import type { Cohesion } from "@mtg/engine";

const coh = (over: Partial<Cohesion> = {}): Cohesion => ({
  theme: "creatures dying", tag: "dies:creature", secondary: null, secondaryTag: null,
  score: 0.46, familyScore: 0.46, label: "focused", dominant: true, ...over,
});
const wins = (cls: string, count: number) => ({
  classes: [{ class: cls, count, share: 1 }], focus: 1, primary: cls,
});

test("all three slots read as one sentence", () => {
  const s = deckSentence(coh(), wins("burn", 20), { count: 18, target: 10 });
  expect(s.win).toBe("wins by damage or drain (20 cards)");
  expect(s.engine).toBe("fueled by creatures dying (46% of nonlands)");
  expect(s.means).toBe("18 interaction cards against a target of 10");
});

// THE ABSTENTION MUST REACH THE SENTENCE (roadmap A15 -> A16). A deck whose theme layer declined to
// name it gets NO engine clause -- `judith-tokens-connoiseur` reads "wins by damage or drain (11
// cards) · 17 interaction cards against a target of 10" and says nothing about an engine, which is
// the truth about a headline carried by 8% of its nonlands.
test("a withdrawn theme leaves the engine slot empty rather than phrasing it", () => {
  const s = deckSentence(coh({ dominant: false }), wins("burn", 11), { count: 17, target: 10 });
  expect(s.engine).toBeNull();
  expect(s.win).not.toBeNull();
});

// A CLASS WITH NO PHRASE IS DROPPED, NEVER PRINTED RAW: `winconReport`'s vocabulary can grow, and
// "wins by stompy" is worse than saying nothing about how the deck wins.
test("an unphrased win class is dropped, not printed raw", () => {
  expect(deckSentence(coh(), wins("some-new-class", 9), undefined).win).toBeNull();
  expect(deckSentence(coh(), undefined, undefined).win).toBeNull();
});

test("one interaction card is not pluralised", () => {
  expect(deckSentence(null, undefined, { count: 1, target: 10 }).means)
    .toBe("1 interaction card against a target of 10");
});
