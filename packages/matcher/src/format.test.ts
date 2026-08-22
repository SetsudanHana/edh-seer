import { describe, expect, test } from "vitest";
import { DEFAULT_POD_SIZE, opponents } from "./format.js";
import { classifyLand, entersTapped } from "./land-conditions.js";

describe("pod size", () => {
  test("the default is a four-player Free-for-All, so three opponents", () => {
    expect(DEFAULT_POD_SIZE).toBe(4);
    expect(opponents()).toBe(3);
  });

  test("a three- or five-player table is an ordinary thing to sit at", () => {
    expect(opponents(3)).toBe(2);
    expect(opponents(5)).toBe(4);
  });

  test("a pod below two is clamped, never trusted — it will arrive from a UI field one day", () => {
    expect(opponents(1)).toBe(1);
    expect(opponents(0)).toBe(1);
    expect(opponents(-3)).toBe(1);
    expect(opponents(4.7)).toBe(3);
  });

  test("the one card it reaches today: Spectator Seating is untapped in a pod and tapped in a duel", () => {
    const seating = classifyLand({
      typeLine: "Land",
      oracleText: "This land enters tapped unless you have two or more opponents.\n{T}: Add {R} or {W}.",
    });
    const board = (podSize: number) =>
      ({ lands: 0, basics: 0, types: new Set<string>(), opponents: opponents(podSize) });
    expect(entersTapped(seating, board(4))).toBe(false);
    expect(entersTapped(seating, board(3))).toBe(false);
    expect(entersTapped(seating, board(2))).toBe(true);
  });
});
