import { expect, test } from "vitest";
import { themeMatrix } from "./theme-matrix.js";

const groups = [
  { category: "draw", label: "Draw Engine", cards: ["Skullclamp", "Grim Haruspex"], pairs: [] },
  { category: "gy", label: "Graveyard Matters", cards: ["Grim Haruspex", "Bojuka Bog"], pairs: [] },
  { category: "tok", label: "Tokens Go Wide", cards: ["Skullclamp"], pairs: [] },
] as never;

test("a card's row flags every group it is in, in the columns' own order", () => {
  const m = themeMatrix(groups, ["Skullclamp", "Grim Haruspex", "Bojuka Bog"])!;
  expect(m.columns.map((c) => c.label)).toEqual(["Draw Engine", "Graveyard Matters", "Tokens Go Wide"]);
  const clamp = m.rows.find((r) => r.name === "Skullclamp")!;
  expect(clamp.member).toEqual([true, false, true]);
  expect(clamp.count).toBe(2);
});

// MOST-CONNECTED FIRST, name breaking the tie -- the ordering rule every ranked list here uses.
test("rows are ranked by how many groups they are in", () => {
  const m = themeMatrix(groups, ["Bojuka Bog", "Skullclamp", "Grim Haruspex"])!;
  expect(m.rows.map((r) => r.name)).toEqual(["Grim Haruspex", "Skullclamp", "Bojuka Bog"]);
});

/** THE HONEST REGION, and it is NAMES rather than a count: a reader deciding what to cut needs to
 *  know which cards talk to nothing, and that list is where a cut conversation starts. Measured on
 *  the review deck: 25 of 82 nonland cards are in no group at all. */
test("cards in no group are separated out and named", () => {
  const m = themeMatrix(groups, ["Skullclamp", "Sol Ring", "Arcane Signet"])!;
  expect(m.rows.map((r) => r.name)).toEqual(["Skullclamp"]);
  expect(m.unaffiliated).toEqual(["Arcane Signet", "Sol Ring"]);
});

// COLUMN ORDER IS THE ENGINE'S. `archetypes` arrives ranked by pair count; re-sorting here would
// put this panel and that ranking into disagreement.
test("columns are never re-sorted, whatever the membership counts say", () => {
  const m = themeMatrix(groups, ["Skullclamp", "Grim Haruspex", "Bojuka Bog"])!;
  expect(m.columns.map((c) => c.category)).toEqual(["draw", "gy", "tok"]);
});

test("no groups, or no cards, means no matrix at all", () => {
  expect(themeMatrix([] as never, ["Sol Ring"])).toBeNull();
  expect(themeMatrix(groups, [])).toBeNull();
  expect(themeMatrix(undefined, ["Sol Ring"])).toBeNull();
});
