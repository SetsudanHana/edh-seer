import { describe, expect, test } from "vitest";
import type { Cohesion } from "@mtg/engine";
import { deckThing, THING_K, THING_TURN } from "./thing.js";

const coh = (over: Partial<Cohesion> = {}): Cohesion => ({
  theme: "equipments entering", tag: "enters:equipment", secondary: null, secondaryTag: null,
  score: 0.27, familyScore: 0.27, label: "focused", dominant: true, ...over,
} as Cohesion);

describe("report.thing", () => {
  /** REGISTERED CRITERION (i). The Card Kingdom consistency article's headline row: 30 cards, two
   *  by turn 3, 86.9%. If this ever moves, either `seen()` or `pAtLeast` changed under us and the
   *  doctrine turn/count are no longer measuring what the article measured. */
  test("the article's 30 → 86.9% row reproduces exactly", () => {
    const t = deckThing(coh(), Array.from({ length: 30 }, (_, i) => `c${i}`), new Set(), 99)!;
    expect(t.turn).toBe(3);
    expect(t.k).toBe(2);
    expect(+(t.probability * 100).toFixed(1)).toBe(86.9);
  });

  test("it abstains exactly where cohesion abstains — a withdrawn claim gets no number", () => {
    expect(deckThing(null, ["a", "b"], new Set(), 99)).toBeNull();
    expect(deckThing(coh({ dominant: false }), ["a", "b"], new Set(), 99)).toBeNull();
  });

  test("a commander is stated separately at P=1, never counted in N", () => {
    // Folding a command-zone card into a DRAW probability understates the deck: it is available in
    // every game. Same rule `deck-math.ts` applies with `fromCommandZone`.
    const t = deckThing(coh(), ["Sram", "Sigarda's Aid", "Colossus Hammer"], new Set(["Sram"]), 99)!;
    expect(t.count).toBe(2);
    expect(t.cards).not.toContain("Sram");
    expect(t.fromCommandZone).toEqual(["Sram"]);
  });

  test("more cards is never less likely, and the doctrine turn/count are the ones quoted", () => {
    const p = (n: number) => deckThing(coh(), Array.from({ length: n }, (_, i) => `c${i}`), new Set(), 99)!.probability;
    expect(p(10)).toBeLessThan(p(20));
    expect(p(20)).toBeLessThan(p(40));
    expect(THING_TURN).toBe(3);
    expect(THING_K).toBe(2);
  });

  test("a deck with fewer than k on-theme cards reads 0, not a near-miss", () => {
    expect(deckThing(coh(), ["only-one"], new Set(), 99)!.probability).toBe(0);
  });
});
