import { expect, test } from "vitest";
import { offThemeSplit } from "./off-theme.js";

const report = (cards: { name: string; roles?: string[] }[], slack: { category: string }[] = []) =>
  ({ cards, slack, buildParents: [] }) as never;

test("a ramp card is held when ramp is at target, free when ramp is in slack", () => {
  const cards = [{ name: "Sol Ring", roles: ["ramp"] }];
  expect(offThemeSplit(["Sol Ring"], report(cards))).toEqual({ free: [], held: ["Sol Ring"] });
  expect(offThemeSplit(["Sol Ring"], report(cards, [{ category: "ramp" }]))).toEqual({ free: ["Sol Ring"], held: [] });
});

test("removal is held even when its role is in slack", () => {
  const cards = [{ name: "Despark", roles: ["targetedRemoval", "ramp"] }];
  expect(offThemeSplit(["Despark"], report(cards, [{ category: "ramp" }]))).toEqual({ free: [], held: ["Despark"] });
});

test("a card with no roles, or only lands, is free; input order is kept", () => {
  const cards = [{ name: "A" }, { name: "B", roles: ["lands"] }, { name: "C", roles: ["ramp"] }];
  expect(offThemeSplit(["A", "C", "B"], report(cards))).toEqual({ free: ["A", "B"], held: ["C"] });
});
