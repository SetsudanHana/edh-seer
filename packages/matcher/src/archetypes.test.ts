import { expect, test } from "vitest";
import { detectArchetypes } from "./archetypes.js";

test("maps a dominant mechanism group to its archetype as the primary", () => {
  const groups = [{ category: "tokens-go-wide", cards: ["A", "B", "C", "D"] }];
  const out = detectArchetypes(groups, [], 40);
  expect(out[0].name).toBe("tokens");
  expect(out[0].label).toBe("Tokens");
  expect(out[0].confidence).toBeCloseTo(4 / 40, 5);
});

test("ranks multiple archetypes by participating-card share, descending", () => {
  const groups = [
    { category: "aristocrats", cards: ["A", "B", "C", "D", "E", "F"] },
    { category: "lifegain-payoff", cards: ["A", "B"] },
  ];
  const out = detectArchetypes(groups, [], 50);
  expect(out.map((r) => r.name)).toEqual(["aristocrats", "lifegain"]);
});

test("several mechanism categories fold into one archetype (graveyard-matters + mill-self -> reanimator)", () => {
  const groups = [
    { category: "reanimator", cards: ["A", "B"] },
    { category: "graveyard-matters", cards: ["B", "C"] },
    { category: "mill-self", cards: ["D"] },
  ];
  const out = detectArchetypes(groups, [], 40);
  // Distinct cards A,B,C,D all count once toward reanimator.
  expect(out[0].name).toBe("reanimator");
  expect(out[0].confidence).toBeCloseTo(4 / 40, 5);
});

test("combos with 2+ cards contribute a combo archetype", () => {
  const out = detectArchetypes([], ["X", "Y"], 30);
  expect(out.some((r) => r.name === "combo")).toBe(true);
});

test("a non-archetype mechanism (wheels-draw) does not produce an archetype", () => {
  const out = detectArchetypes([{ category: "wheels-draw", cards: ["A", "B", "C"] }], [], 40);
  expect(out).toEqual([{ name: "goodstuff", label: "Goodstuff / Midrange", confidence: 0 }]);
});

test("no archetype above the floor yields the goodstuff fallback", () => {
  const out = detectArchetypes([{ category: "tokens-go-wide", cards: ["A"] }], [], 99); // 1/99 < 0.08
  expect(out).toEqual([{ name: "goodstuff", label: "Goodstuff / Midrange", confidence: 0 }]);
});

test("empty inputs yield the goodstuff fallback", () => {
  expect(detectArchetypes([], [], 0)).toEqual([{ name: "goodstuff", label: "Goodstuff / Midrange", confidence: 0 }]);
});
