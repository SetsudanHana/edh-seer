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

// FILLS (#1137): a short role is closed by the report's own suggestions, for the cut list's weakest cards.
const fillDeck = [...deck, card("Weak A", 2), card("Weak B", 2), card("Weak C", 2), { ...card("Some Land", 0), typeLine: "Land" } as Card];
const fillPool = new Map([...pool, ["Fellwar Stone", card("Fellwar Stone", 2)], ["Prismatic Lens", card("Prismatic Lens", 2)], ["The Mind Stone", card("The Mind Stone", 2)], ["Tempting Rock", card("Tempting Rock", 2, true)]]);
const fillInput = (over: Partial<GatherInput> = {}) => input({
  deck: fillDeck, cardOf: (n) => fillPool.get(n), inDeck: new Set(fillDeck.map((c) => c.name)),
  fills: {
    ramp: {
      label: "ramp", noun: "ramp", short: 2,
      adds: [{ name: "Tempting Rock", reason: "Tempting Rock is ramp." }, { name: "Fellwar Stone", reason: "Fellwar Stone makes mana." }, { name: "Prismatic Lens", reason: "Prismatic Lens makes mana." }, { name: "The Mind Stone", reason: "The Mind Stone makes mana." }],
      cuts: [{ name: "Some Land", why: "" }, { name: "Weak A", why: "Works with 1 card." }, { name: "Weak B", why: "Works with 2 cards." }, { name: "Weak C", why: "Works with 3 cards." }],
    },
  },
  ...over,
});

test("a short role is filled up to the shortfall: the cut list's weakest for the report's suggestions, in order", () => {
  const p = gatherPackage(fillInput({ target: 3 }))!;
  const ramp = p.sections.find((s) => s.id === "ramp")!.swaps;
  // Tempting Rock is a Game Changer, which bracket 3 allows one of.
  expect(ramp.every((s) => s.kind === "fill")).toBe(true);
  expect(ramp.length).toBe(2);
  expect(ramp.map((s) => s.out.name)).toEqual(["Weak A", "Weak B"]);
  expect(ramp[0]!.out.reason).toContain("next on the report's cut list");
  expect(ramp[0]!.in.reason).toContain("Ramp: you were 2 short; ");
});

test("a fill the guard refuses is skipped and the next suggestion takes its cut; a land is never cut", () => {
  const p = gatherPackage(fillInput({ target: 2 }))!;
  const ramp = p.sections.find((s) => s.id === "ramp")!.swaps;
  expect(ramp.map((s) => [s.out.name, s.in.name])).toEqual([["Weak A", "Fellwar Stone"], ["Weak B", "Prismatic Lens"]]);
});

test("a fill never reuses a card another swap cut or added", () => {
  const synergy = [{ out: "Weak A", in: "Fellwar Stone", outReason: "x", inReason: "y" }];
  const p = gatherPackage(fillInput({ target: 2, synergy }))!;
  const all = p.sections.flatMap((s) => s.swaps);
  expect(new Set(all.map((s) => s.out.name)).size).toBe(all.length);
  expect(new Set(all.map((s) => s.in.name)).size).toBe(all.length);
  expect(p.sections.find((s) => s.id === "ramp")!.swaps.map((s) => s.out.name)).toEqual(["Weak A", "Weak B"]);
  // The fill came first, so the synergy pair that wanted Weak A and Fellwar Stone found both taken.
  expect(p.sections.find((s) => s.id === "synergy")!.swaps.map((s) => s.out.name)).not.toContain("Weak A");
});

test("fills lead their section and push efficiency swaps out of the cap, never the other way", () => {
  const many = Array.from({ length: 10 }, (_, i) => card(`Rock ${i}`, 3));
  const adds = Array.from({ length: 10 }, (_, i) => card(`Better ${i}`, 1));
  const d = [...fillDeck, ...many];
  const roles = { ...input().roles, ramp: many.map((c, i) => ({ cut: c.name, options: [roleOpt(`Better ${i}`, { role: "ramp" })] })) };
  const p = gatherPackage(fillInput({
    target: 3, roles, deck: d, inDeck: new Set(d.map((c) => c.name)), cardOf: (n) => fillPool.get(n) ?? adds.find((c) => c.name === n),
  }))!;
  const ramp = p.sections.find((s) => s.id === "ramp")!.swaps;
  expect(ramp.length).toBe(10);
  expect(ramp.slice(0, 2).map((s) => s.kind)).toEqual(["fill", "fill"]);
  expect(ramp.filter((s) => s.kind === "role").length).toBe(8);
  // The two efficiency swaps given up are the last two, and their cards are free again.
  expect(ramp.map((s) => s.out.name)).not.toContain("Rock 9");
});

test("no shortfall, no fill", () => {
  const p = gatherPackage(fillInput({ fills: {} }))!;
  expect(p.sections.flatMap((s) => s.swaps).some((s) => s.kind === "fill")).toBe(false);
});
