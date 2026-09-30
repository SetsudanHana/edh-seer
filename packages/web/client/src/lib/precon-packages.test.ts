import { expect, test } from "vitest";
import type { UpgradePackage, UpgradeSwap } from "@edh-seer/matcher/upgrade-package";
import type { AnalyzeResponse } from "../types.js";
import { keepManaBase } from "./precon-packages.js";

const swap = (out: string, add: string, kind: UpgradeSwap["kind"]): UpgradeSwap => ({ kind, out: { name: out, reason: "r" }, in: { name: add, reason: "r" } });
const pkg = (over: Partial<UpgradePackage> = {}): UpgradePackage => ({
  target: 2, from: "1-2", bringDown: [],
  sections: [
    { id: "lands", swaps: [swap("Temple", "Chapel", "land")] },
    { id: "synergy", swaps: [swap("A", "Heavy Pips", "synergy"), swap("B", "Big Drop", "synergy"), swap("C", "Cheap", "synergy")] },
  ],
  ...over,
});
const input = (analyse: (list: string) => { band: "1-2" | "3" | "4-5"; mana: number; synergy: number }) => ({
  commanders: ["Commander"],
  cards: ["Temple", "A", "B", "C", "Combo Piece"].map((name) => ({ name, count: 1 })),
  data: { report: { deckMath: { lands: { manaBase: { total: 0.18 } } } } } as unknown as AnalyzeResponse,
  analyse: async (list: string) => analyse(list),
});
const names = (p: UpgradePackage) => p.sections.flatMap((s) => s.swaps).map((s) => s.in.name);

test("the swap whose removal reads best goes, not the one with the most coloured pips", async () => {
  // Mono-coloured: the total moves with the curve alone, and only Big Drop raises it.
  const kept = await keepManaBase(pkg(), input((l) => ({ band: "1-2", mana: l.includes("Big Drop") ? 0.2 : 0.18, synergy: 3 })), () => []);
  expect(names(kept)).toEqual(["Chapel", "Heavy Pips", "Cheap"]);
  expect(kept.after).toEqual({ band: "1-2", mana: 0.18, synergy: 3 });
});

test("a package the report reads above its target loses the swap that put it there", async () => {
  // The report's band reads a combo the guard's list did not: Heavy Pips with Combo Piece.
  const kept = await keepManaBase(pkg(), input((l) => ({ band: l.includes("Heavy Pips") ? "3" : "1-2", mana: 0.18, synergy: 3 })), () => []);
  expect(names(kept)).toEqual(["Chapel", "Big Drop", "Cheap"]);
  expect(kept.after?.band).toBe("1-2");
});

test("a bring-down cut takes its next replacement before any swap is dropped", async () => {
  const p = pkg({ bringDown: [swap("Game Changer", "Low Curve", "bring-down")] });
  const alt = swap("Game Changer", "Same Curve", "bring-down");
  const kept = await keepManaBase(p, input((l) => ({ band: "1-2", mana: l.includes("Low Curve") ? 0.19 : 0.18, synergy: 3 })), (_, w) => (w.in.name === "Low Curve" ? [alt] : []));
  expect(kept.bringDown.map((s) => s.in.name)).toEqual(["Same Curve"]);
  expect(names(kept)).toEqual(["Chapel", "Heavy Pips", "Big Drop", "Cheap"]);
});

test("land swaps never go, and a package that cannot fit ships without an after reading", async () => {
  const kept = await keepManaBase(pkg(), input(() => ({ band: "1-2", mana: 0.3, synergy: 3 })), () => []);
  expect(names(kept)).toEqual(["Chapel"]);
  expect(kept.after).toBeUndefined();
});
