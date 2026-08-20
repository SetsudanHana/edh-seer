import { expect, test } from "vitest";
import { diffRuns, snapshotRun, type RunSnapshot } from "./run-diff.js";
import { SAMPLE } from "../fixtures.js";

const base: RunSnapshot = {
  cards: ["Sol Ring", "Krenko, Mob Boss", "Impact Tremors", "Mountain"],
  synergy: 3.4,
  build: 3.7,
  theme: "tokens entering",
  categories: { ramp: 6, draw: 14 },
};

test("a swap reports the cards, the scores and the categories that moved", () => {
  const next: RunSnapshot = {
    ...base,
    cards: ["Sol Ring", "Krenko, Mob Boss", "Impact Tremors", "Arcane Signet"],
    synergy: 3.9,
    categories: { ramp: 7, draw: 14 },
  };
  const d = diffRuns(base, next)!;
  expect(d.added).toEqual(["Arcane Signet"]);
  expect(d.removed).toEqual(["Mountain"]);
  expect(d.synergy).toEqual({ from: 3.4, to: 3.9 });
  expect(d.categories).toEqual([{ category: "ramp", from: 6, to: 7 }]);
  // Unmoved figures are absent rather than rendered as "3.7 -> 3.7", which reads as a bug.
  expect(d.build).toBeUndefined();
  expect(d.theme).toBeUndefined();
});

// THE SCORES ARE COMPARED AS PRINTED. The panel renders one decimal, so a 0.04 move is invisible on
// screen and a strip claiming it moved is the strip contradicting the page.
test("a change too small to render is not reported", () => {
  expect(diffRuns(base, { ...base, synergy: 3.44 })).toBeNull();
});

test("re-analysing an unchanged deck says nothing at all", () => {
  expect(diffRuns(base, { ...base })).toBeNull();
});

// A DIFFERENT DECK IS NOT AN EDIT. "+63 cards, -61 cards" is noise wearing the costume of a
// finding, so the strip refuses rather than describing a paste.
test("a different deck reports nothing", () => {
  const other: RunSnapshot = { ...base, cards: ["Island", "Counterspell", "Brainstorm", "Ponder"] };
  expect(diffRuns(base, other)).toBeNull();
});

test("a snapshot carries the deck, both scores, the theme and the build counts", () => {
  const snap = snapshotRun(SAMPLE);
  expect(snap.cards).toContain("Krenko, Mob Boss");
  expect(snap.synergy).toBe(SAMPLE.report.synergyOverall);
  expect(snap.build).toBe(SAMPLE.report.buildScore);
  expect(snap.theme).toBe(SAMPLE.report.cohesion!.theme);
  expect(snap.categories.ramp).toBe(6);
});
