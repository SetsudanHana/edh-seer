import { expect, test } from "vitest";
import type { Card, Combo } from "@edh-seer/engine";
import { bringDown } from "./bracket-guard.js";
import { gatherPackage, type GatherInput } from "./upgrade-gatherer.js";
import type { RoleOption } from "./upgrade-sections.js";
import type { LandFacts } from "./land-score.js";

const card = (name: string, manaValue: number, gameChanger?: boolean): Card => ({
  name, typeLine: "Instant", oracleText: "", keywords: [], colors: [], manaValue, ...(gameChanger !== undefined ? { gameChanger } : {}),
} as Card);
const roleOpt = (add: string, over: Partial<RoleOption> = {}): RoleOption => ({
  add, role: "targetedRemoval", gained: ["manaValue"], cut: { manaValue: 3, timing: 2 }, addIngredients: { manaValue: 1, timing: 2 }, gameChanger: false, links: 0, ...over,
});
const lf = (name: string, tapped: 0 | 1 | 2, colours: string[]): LandFacts => ({ name, colours: colours as LandFacts["colours"], tapped, utility: [], hurts: false, basic: false, front: true });

const deck = [card("Commander", 3), card("Crib Swap", 3), card("Murder", 3), card("Temple of Silence", 0), card("Stick Together", 5)];
const pool = new Map([
  ["Swords to Plowshares", card("Swords to Plowshares", 1)], ["Path to Exile", card("Path to Exile", 1)],
  ["Rhystic Removal", card("Rhystic Removal", 1, true)], ["Isolated Chapel", card("Isolated Chapel", 0)], ["Pious Evangel", card("Pious Evangel", 3)],
  ["Isochron Scepter", card("Isochron Scepter", 2)], ["Dramatic Reversal", card("Dramatic Reversal", 2)],
]);
const input = (over: Partial<GatherInput> = {}): GatherInput => ({
  target: 3, from: "1-2", deck, combos: [], cardOf: (n) => pool.get(n), inDeck: new Set(deck.map((c) => c.name)),
  bringDown: { cuts: [], reachable: true }, replacements: new Map(),
  roles: {
    ramp: [], consistency: [], wipes: [],
    interaction: [{ cut: "Crib Swap", options: [roleOpt("Swords to Plowshares"), roleOpt("Path to Exile")] }, { cut: "Murder", options: [roleOpt("Swords to Plowshares"), roleOpt("Path to Exile")] }],
  },
  lands: [{ cut: "Temple of Silence", options: [{ add: "Isolated Chapel", cut: lf("Temple of Silence", 2, ["W", "B"]), addFacts: lf("Isolated Chapel", 1, ["W", "B"]), untapped: true, colours: [], gameChanger: false }] }],
  synergy: [{ out: "Stick Together", in: "Pious Evangel", outReason: "Stick Together works with 13 cards in this deck; Pious Evangel works with 42.", inReason: "Pious Evangel puts cards into the graveyard that Sevinne's Reclamation can bring back" }],
  ...over,
});

test("the sections come in page order, each card cut and added once", () => {
  const p = gatherPackage(input())!;
  expect(p.sections.map((s) => s.id)).toEqual(["lands", "ramp", "consistency", "interaction", "wipes", "synergy"]);
  const interaction = p.sections.find((s) => s.id === "interaction")!.swaps;
  // Swords went to Crib Swap, so Murder takes its next option.
  expect(interaction.map((s) => [s.out.name, s.in.name])).toEqual([["Crib Swap", "Swords to Plowshares"], ["Murder", "Path to Exile"]]);
  expect(p.sections.find((s) => s.id === "lands")!.swaps[0]!.in.name).toBe("Isolated Chapel");
  expect(p.sections.find((s) => s.id === "synergy")!.swaps[0]!.kind).toBe("synergy");
});

test("the guard refuses a Game Changer at bracket 2 and takes the next option", () => {
  const roles = { ...input().roles, interaction: [{ cut: "Crib Swap", options: [roleOpt("Rhystic Removal"), roleOpt("Swords to Plowshares")] }] };
  const two = gatherPackage(input({ target: 2, roles }))!;
  expect(two.sections.find((s) => s.id === "interaction")!.swaps.map((s) => s.in.name)).toEqual(["Swords to Plowshares"]);
  const four = gatherPackage(input({ target: 4, roles }))!;
  expect(four.sections.find((s) => s.id === "interaction")!.swaps.map((s) => s.in.name)).toEqual(["Rhystic Removal"]);
});

test("the guard refuses an add that completes a forbidden combo", () => {
  const withReversal = [...deck, card("Dramatic Reversal", 2)];
  const combos: Combo[] = [{ cards: ["Dramatic Reversal", "Isochron Scepter"], result: "Infinite mana" }];
  const roles = { ...input().roles, interaction: [{ cut: "Crib Swap", options: [roleOpt("Isochron Scepter"), roleOpt("Swords to Plowshares")] }] };
  const p = gatherPackage(input({ deck: withReversal, combos, roles }))!;
  expect(p.sections.find((s) => s.id === "interaction")!.swaps.map((s) => s.in.name)).toEqual(["Swords to Plowshares"]);
});

test("a deck above the target opens with its bring-down cuts, each replaced", () => {
  const gcDeck = [...deck, card("Cyclonic Rift", 2, true)];
  const bd = bringDown(gcDeck, [], 2, ["Commander"], new Map());
  const p = gatherPackage(input({ target: 2, from: "3", deck: gcDeck, bringDown: bd, replacements: new Map([["Cyclonic Rift", [{ add: "Path to Exile", role: "targetedRemoval", links: 0 }]]]) }))!;
  expect(p.bringDown.map((s) => [s.out.name, s.in.name])).toEqual([["Cyclonic Rift", "Path to Exile"]]);
  expect(p.bringDown[0]!.out.reason).toContain("Game Changer");
  // Path went to the bring-down, so the sections cannot take it again.
  expect(p.sections.find((s) => s.id === "interaction")!.swaps.map((s) => s.in.name)).not.toContain("Path to Exile");
});

test("an add already on the precon's list is never taken, even when that card did not resolve", () => {
  const p = gatherPackage(input({ inDeck: new Set([...deck.map((c) => c.name), "Swords to Plowshares"]) }))!;
  expect(p.sections.find((s) => s.id === "interaction")!.swaps.map((s) => s.in.name)).toEqual(["Path to Exile"]);
});

test("an unreachable target has no package", () => {
  expect(gatherPackage(input({ target: 2, bringDown: { cuts: [], reachable: false } }))).toBeNull();
});

test("a Game Changer upgrade is its own kind: refused at bracket 2, taken to the cap at 3, every one at 4", () => {
  const gcs = ["Rhystic Removal", "Fierce Removal", "Vault Removal", "Tithe Removal"];
  for (const n of gcs) pool.set(n, card(n, 1, true));
  const cuts = ["Crib Swap", "Murder", "Doom Blade", "Go for the Throat"];
  const big = [...deck, ...cuts.slice(2).map((n) => card(n, 2))];
  const gc = (add: string) => roleOpt(add, { gained: [], gameChanger: true, upgrade: "game-changer" });
  const roles = { ...input().roles, interaction: cuts.map((cut, i) => ({ cut, options: [gc(gcs[i]!), roleOpt(`Plain ${i}`)] })) };
  for (let i = 0; i < 4; i++) pool.set(`Plain ${i}`, card(`Plain ${i}`, 1));
  const at = (target: 2 | 3 | 4) => gatherPackage(input({ target, deck: big, inDeck: new Set(big.map((c) => c.name)), roles }))!.sections.find((s) => s.id === "interaction")!.swaps;
  expect(at(2).map((s) => s.kind)).toEqual(["role", "role", "role", "role"]);
  expect(at(3).map((s) => s.kind)).toEqual(["game-changer", "game-changer", "game-changer", "role"]);
  expect(at(4).map((s) => s.kind)).toEqual(["game-changer", "game-changer", "game-changer", "game-changer"]);
  expect(at(4)[0]!.in.reason).toMatch(/Game Changer, which this bracket allows/);
});

// #966 T1: worst-first cuts must not strand a later cut whose only option is the scarce add.
const landCut = (cut: string, tapped: 0 | 1 | 2, adds: string[]) => ({
  cut,
  options: adds.map((a) => ({ add: a, cut: lf(cut, tapped, ["W"]), addFacts: lf(a, 0, ["W"]), untapped: true, colours: [], gameChanger: false })),
});
const landSwaps = (lands: GatherInput["lands"]) =>
  gatherPackage(input({ lands, roles: { ramp: [], consistency: [], wipes: [], interaction: [] }, synergy: [] }))!
    .sections.find((s) => s.id === "lands")!.swaps.map((s) => [s.out.name, s.in.name]);

test("land adds are matched, not taken greedily: the worse cut takes its second option so the later cut keeps its only one", () => {
  // Abzan Armor shape: Temple of Plenty (always tapped) prefers Isolated Chapel; Sunpetal Grove can only have Chapel.
  expect(landSwaps([landCut("Temple of Plenty", 2, ["Isolated Chapel", "Pious Evangel"]), landCut("Sunpetal Grove", 1, ["Isolated Chapel"])]))
    .toEqual([["Temple of Plenty", "Pious Evangel"], ["Sunpetal Grove", "Isolated Chapel"]]);
});

test("an uncontested best add stays with the worse cut", () => {
  expect(landSwaps([landCut("Temple of Plenty", 2, ["Isolated Chapel", "Pious Evangel"]), landCut("Sunpetal Grove", 1, ["Pious Evangel"])]))
    .toEqual([["Temple of Plenty", "Isolated Chapel"], ["Sunpetal Grove", "Pious Evangel"]]);
});
