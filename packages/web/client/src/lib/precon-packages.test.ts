import { expect, test } from "vitest";
import type { UpgradePackage, UpgradeSwap } from "@edh-seer/matcher/upgrade-package";
import type { AnalyzeResponse, DeckReport } from "../types.js";
import { chooseCuts } from "./cut-choice.js";
import { buildEngineModel } from "./engine-model.js";
import { engineDeck } from "./engine-model.fixture.js";
import { fillCuts, fillsFor, keepManaBase } from "./precon-packages.js";

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
  analyse: async (list: string) => ({ build: 4, short: [], ...analyse(list) }),
});
const names = (p: UpgradePackage) => p.sections.flatMap((s) => s.swaps).map((s) => s.in.name);

test("the swap whose removal reads best goes, not the one with the most coloured pips", async () => {
  // Mono-coloured: the total moves with the curve alone, and only Big Drop raises it.
  const kept = await keepManaBase(pkg(), input((l) => ({ band: "1-2", mana: l.includes("Big Drop") ? 0.2 : 0.18, synergy: 3 })), () => []);
  expect(names(kept)).toEqual(["Chapel", "Heavy Pips", "Cheap"]);
  expect(kept.after).toEqual({ band: "1-2", mana: 0.18, synergy: 3, build: 4, short: [] });
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

test("a fill is dropped last: at equal mana base cost the keeper drops an ordinary swap first", async () => {
  const p = pkg({ sections: [{ id: "synergy", swaps: [swap("B", "Fill Rock", "fill"), swap("A", "Heavy Pips", "synergy")] }] });
  // Either one alone fixes the mana base; the keeper drops the synergy swap.
  const kept = await keepManaBase(p, input((l) => ({ band: "1-2", mana: l.includes("Heavy Pips") && l.includes("Fill Rock") ? 0.2 : 0.18, synergy: 3 })), () => []);
  expect(names(kept)).toEqual(["Fill Rock"]);
});

test("fills are made for the groups the report is short in, from the report's suggestions", () => {
  const sug = { build: { Ramp: [{ name: "Fellwar Stone", reasons: [{ text: "Fellwar Stone makes mana.", others: [] }] }], Interaction: [{ name: "Swords", reasons: [] }] } } as unknown as Parameters<typeof fillsFor>[1];
  const cuts = [{ name: "Weak A", why: "Works with 1 card." }];
  const f = fillsFor([{ group: "Ramp", have: 9, target: 11 }, { group: "Card draw", have: 1, target: 2 }, { group: "Consistency", have: 1, target: 2 }], sug, cuts);
  expect(f.consistency).toBeUndefined();
  expect(Object.keys(f)).toEqual(["ramp"]);
  expect(f.ramp).toEqual({ label: "ramp", noun: "ramp", short: 2, adds: [{ name: "Fellwar Stone", reason: "Fellwar Stone makes mana." }], cuts });
  expect(fillsFor([{ group: "Ramp", have: 9, target: 11 }], null, cuts)).toEqual({});
});

test("a fill never cuts a card a win plan counts or the table is warned about, read off the real cut list", () => {
  const { report, graph } = engineDeck();
  const trim = [
    { name: "Planned", rating: 0.1, partners: 1, manaValue: 2, reasons: ["only 1 card connects to it"], protections: [] },
    { name: "Warned", rating: 0.1, partners: 1, manaValue: 2, reasons: ["only 1 card connects to it"], protections: [] },
    { name: "Free", rating: 0.1, partners: 1, manaValue: 2, reasons: ["only 1 card connects to it"], protections: [] },
  ];
  const node = (graph.nodes as unknown as { id: string; oracleText?: string }[]).find((n) => n.id === "Warned");
  if (node) node.oracleText = "Gain control of target artifact.";
  const r = { ...report, trim, deckMath: { ...report.deckMath, wincons: { focus: 1, primary: "go-wide", classes: [{ class: "go-wide", count: 1, share: 1, cards: ["Planned"] }] } } } as DeckReport;
  const choices = chooseCuts(r, buildEngineModel(r, graph));
  expect(choices.find((c) => c.name === "Planned")?.onPlan).toBe(true);
  expect(fillCuts(choices, []).map((c) => c.name)).not.toContain("Planned");
  expect(fillCuts(choices, []).map((c) => c.name)).toContain("Free");
  expect(fillCuts(choices, ["Free"]).map((c) => c.name)).not.toContain("Free");
});

test("a keep that is not on-plan rides along into the reason", () => {
  const cuts = fillCuts([{ name: "Soft", onPlan: false, keeps: ["it scores 2 for synergy"], reasons: [], row: { why: "Soft why" } }], []);
  expect(cuts).toEqual([{ name: "Soft", why: "Soft why", keep: "it scores 2 for synergy" }]);
});
