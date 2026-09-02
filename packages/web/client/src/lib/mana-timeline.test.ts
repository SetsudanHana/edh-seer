import { expect, test } from "vitest";
import { manaTimeline } from "./mana-timeline.js";

const row = (turn: number, median: number) =>
  ({ turn, mana: { median, p25: median, p75: median }, payableShare: { median: 0, p25: 0, p75: 0 } });

// THE REVIEW DECK'S OWN NUMBERS, and the reason this join is measured rather than assumed: the
// median stalls at 5 through turn 6, so MV 6 lands on turn SEVEN and MV 7+ is never covered inside
// the simulated turns. The on-curve convention draws all nine of those cards as fine.
const ROWS = [1, 2, 3, 4, 5, 5, 6, 6].map((m, i) => row(i + 1, m));
const CURVE = [
  { value: 0, count: 0 }, { value: 1, count: 5 }, { value: 2, count: 14 }, { value: 3, count: 19 },
  { value: 4, count: 12 }, { value: 5, count: 4 }, { value: 6, count: 4 }, { value: 7, count: 5 },
];

test("a cost lands on the first turn this deck's median actually covers it", () => {
  const t = manaTimeline(CURVE, ROWS)!;
  const at = (turn: number) => t.columns.find((c) => c.turn === turn)!.unlocked;
  expect(at(1)).toBe(5);
  expect(at(5)).toBe(4);
  // NOT turn 6: the median is still 5 there, so a 6-drop is not payable yet.
  expect(at(6)).toBe(0);
  expect(at(7)).toBe(4);
});

test("costs the median never reaches are counted, not dropped", () => {
  const t = manaTimeline(CURVE, ROWS)!;
  expect(t.never).toEqual({ count: 5, afterTurn: 8 });
});

// A ZERO-COST CARD IS PAYABLE BEFORE ANY MANA EXISTS.
test("a zero-cost card belongs to the first turn, not to a turn nothing occupies", () => {
  const t = manaTimeline([{ value: 0, count: 3 }], [row(1, 1)])!;
  expect(t.columns[0]!.unlocked).toBe(3);
});

test("the peak is the largest single unlock", () => {
  const t = manaTimeline(CURVE, ROWS)!;
  expect(t.peak).toEqual({ turn: 3, count: 19 });
});

// A deck whose supply covers everything admits nothing, rather than printing a zero.
test("nothing is stranded when the median covers the whole curve", () => {
  const t = manaTimeline([{ value: 1, count: 2 }], [row(1, 1), row(2, 2)])!;
  expect(t.never.count).toBe(0);
});

test("no rows means no timeline at all, never an empty chart", () => {
  expect(manaTimeline(CURVE, [])).toBeNull();
});
