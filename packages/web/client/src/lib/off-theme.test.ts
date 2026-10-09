import { expect, test } from "vitest";
import { offThemeSplit } from "./off-theme.js";

// The production shape: slack names PARENTS, expanded to leaf roles through buildParents.
const parents = [
  { name: "Ramp", leaves: ["ramp"] },
  { name: "Interaction", leaves: ["targetedRemoval", "stackInteraction", "boardWipe", "graveyardHate"] },
];
const report = (cards: { name: string; roles?: string[] }[], slack: string[] = []) =>
  ({ cards, slack: slack.map((category) => ({ category })), buildParents: parents }) as never;

const sol = [{ name: "Sol Ring", roles: ["ramp"] }];

test("ramp is held at target and free when Ramp is over", () => {
  expect(offThemeSplit(["Sol Ring"], report(sol))).toEqual({ free: [], held: ["Sol Ring"] });
  expect(offThemeSplit(["Sol Ring"], report(sol, ["Ramp"]))).toEqual({ free: ["Sol Ring"], held: [] });
});

test("a counterspell stays held even when Interaction is over", () => {
  const cards = [{ name: "Arcane Denial", roles: ["stackInteraction"] }];
  expect(offThemeSplit(["Arcane Denial"], report(cards, ["Interaction"]))).toEqual({ free: [], held: ["Arcane Denial"] });
});

test("a role with no target (stax) does not hold a card", () => {
  const cards = [{ name: "Propaganda", roles: ["stax"] }];
  expect(offThemeSplit(["Propaganda"], report(cards))).toEqual({ free: ["Propaganda"], held: [] });
});

test("lands-only and role-less cards are free; input order is kept", () => {
  const cards = [{ name: "A" }, { name: "B", roles: ["lands"] }, { name: "Sol Ring", roles: ["ramp"] }];
  expect(offThemeSplit(["A", "Sol Ring", "B"], report(cards))).toEqual({ free: ["A", "B"], held: ["Sol Ring"] });
});
