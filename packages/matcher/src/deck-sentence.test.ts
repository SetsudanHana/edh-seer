import { expect, test } from "vitest";
import { deckSentence } from "./deck-sentence.js";
import type { Cohesion } from "@edh-seer/engine";

const coh = (over: Partial<Cohesion> = {}): Cohesion => ({
  theme: "creatures dying", name: "Aristocrats", tag: "dies:creature", secondary: null,
  secondaryName: null,
  secondaryTag: null, score: 0.46, onThemeCount: 29, nonlandCount: 63, familyScore: 0.46, label: "concentrated", dominant: true, ...over,
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

/** K4: the win slot is not an argmax. */
const multi = (...cs: { class: string; count: number; cards?: string[] }[]) => ({
  classes: cs.map((c) => ({ ...c, share: 1 / cs.length })), focus: 1, primary: cs[0].class,
});

test("an alternate win condition beats a bigger class, and NAMES the card", () => {
  // One Thassa's Oracle IS the plan, whatever else the deck plays -- the owner's own ruling, and
  // the reason `alt-win` is exempt from the wincon floor in the first place.
  const s = deckSentence(
    coh(),
    multi({ class: "go-wide", count: 30 }, { class: "alt-win", count: 1, cards: ["Thassa's Oracle"] }),
    { count: 8, target: 10 },
  );
  expect(s.win).toBe("wins by an alternate win condition (Thassa's Oracle)");
});

test("combo takes the slot ONLY when the deck's dominant archetype is combo", () => {
  const w = multi({ class: "burn", count: 14 }, { class: "combo", count: 7 });
  // 29 of 71 decks hold a combo and only 6 ARE combo decks. Presence is not a plan.
  expect(deckSentence(coh(), w, undefined, "aristocrats").win).toBe("wins by damage or drain (14 cards)");
  expect(deckSentence(coh(), w, undefined, "combo").win).toBe("wins by a combo (7 cards)");
});

test("an ineligible combo is removed from the ARGMAX too, not merely from the preference", () => {
  // Otherwise a 3-piece combo in a counters deck still headlines "wins by a combo" by out-counting
  // everything else -- the same wrong sentence by a different route.
  const w = multi({ class: "combo", count: 3 }, { class: "go-wide", count: 2 });
  expect(deckSentence(coh(), w, undefined, "counters").win).toBe("wins by attacking with a wide board (2 cards)");
});

test("a combo deck's piece list is a COUNT, never 28 card names in a sentence", () => {
  const cards = Array.from({ length: 28 }, (_, i) => `piece ${i}`);
  const s = deckSentence(coh(), multi({ class: "combo", count: 28, cards }), undefined, "combo");
  expect(s.win).toBe("wins by a combo (28 cards)");
});

test("no deck's slot goes from something to nothing when combo is gated away", () => {
  // Criterion (iv): gating must never empty the slot. A combo-only class list with no eligibility
  // has nothing left to name, and that is the one case allowed to be null.
  expect(deckSentence(coh(), multi({ class: "combo", count: 3 }), undefined, "tokens").win).toBeNull();
  expect(deckSentence(coh(), multi({ class: "combo", count: 3 }, { class: "burn", count: 1 }), undefined, "tokens").win)
    .toBe("wins by damage or drain (1 card)");
});
