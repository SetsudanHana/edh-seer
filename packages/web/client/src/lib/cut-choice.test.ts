import { expect, test } from "vitest";
import type { DeckReport } from "../types.js";
import { buildEngineModel } from "./engine-model.js";
import { engineDeck } from "./engine-model.fixture.js";
import { chooseCuts, keepWords, swapCandidates } from "./cut-choice.js";

const CORE = "doesn't fill a core role (ramp, draw, removal…)";

function withTrim() {
  const { report, graph } = engineDeck();
  const trim = [
    { name: "Payoff A", rating: 0.1, partners: 12, manaValue: 3, reasons: ["only 12 cards connect to it", CORE], protections: [] },
    { name: "Doom Blade", rating: 0, partners: 0, manaValue: 2, reasons: ["nothing in the deck connects to it"], protections: ["fills targetedRemoval"] },
    { name: "Sidekick", rating: 0.2, partners: 3, manaValue: 2, reasons: ["only 3 cards connect to it", CORE], protections: ["its best edge is on your main theme"] },
    { name: "Cleric 1", rating: 1.9, partners: 14, manaValue: 2, reasons: ["14 cards connect to it, but none of those links is strong"], protections: ["connects to 14 cards, more than half this deck"] },
    { name: "Raise Once", rating: 0.1, partners: 1, manaValue: 2, reasons: ["only 1 card connects to it", CORE], protections: [] },
    { name: "Vanilla", rating: 0, partners: 0, manaValue: 5, reasons: ["nothing in the deck connects to it", CORE, "its condition needs a Cleric, and nothing in the deck provides that"], protections: [] },
  ];
  const r = { ...report, trim } as DeckReport;
  return { report: r, model: buildEngineModel(r, graph) };
}

test("a role keeps a card off the list, and so does being a theme's key card", () => {
  const { report, model } = withTrim();
  const names = chooseCuts(report, model).map((c) => c.name);
  expect(names).not.toContain("Doom Blade");
  expect(names).not.toContain("Payoff A");
  expect(names).not.toContain("Cleric 1");
});

test("the main theme argues for a card instead of hiding it, and sorts it after the cards nothing argues for", () => {
  const { report, model } = withTrim();
  const cuts = chooseCuts(report, model);
  expect(cuts.map((c) => c.name)).toEqual(["Vanilla", "Raise Once", "Sidekick"]);
  // THE LINK BY NAME (#981): "its strongest link is to your main theme" named no card, word for
  // word under two cards on Rani, and stopped the plan-seeker.
  expect(cuts[2]!.keeps).toHaveLength(1);
  expect(cuts[2]!.keeps[0]).toMatch(/^its strongest link: /);
});

/** A CARD THE TABLE IS WARNED ABOUT IS NOT A SILENT CUT (#982): Treasure Nabber was "Heads-up: it
 *  steals permanents" in Say this at the table and the second card on the cut list. */
test("a card the table talk warns about carries that as a reason to keep it", () => {
  const { report, graph } = engineDeck();
  const node = (graph.nodes as unknown as { id: string; oracleText?: string }[]).find((n) => n.id === "Raise Once")!;
  node.oracleText = "Gain control of target artifact.";
  const r = { ...report, trim: withTrim().report.trim } as DeckReport;
  const raise = chooseCuts(r, buildEngineModel(r, graph)).find((c) => c.name === "Raise Once")!;
  expect(raise.keeps).toContain("you warn the table that it steals permanents");
});

test("each row reads the Overview's wording and keeps the report's unmet condition, without the clause every row shared", () => {
  const { report, model } = withTrim();
  const vanilla = chooseCuts(report, model)[0]!;
  expect(vanilla.row?.why).toBe("Works with nothing else in this deck.");
  expect(vanilla.unmet).toEqual(["its condition needs a Cleric, and nothing in the deck provides that"]);
  expect(vanilla.reasons).not.toContain(CORE);
  expect(vanilla.card?.name).toBe("Vanilla");
});

test("without a graph the report's own reasons stand in", () => {
  const { report } = withTrim();
  const cuts = chooseCuts(report, null);
  expect(cuts.map((c) => c.name)).toEqual(["Payoff A", "Raise Once", "Vanilla", "Sidekick"]);
  expect(cuts[0]!.row).toBeUndefined();
  expect(cuts[0]!.reasons).toEqual(["only 12 cards connect to it"]);
});

test("a saved report from before trim mode falls back to its passive cut list", () => {
  const { report } = engineDeck();
  const old = { ...report, cutList: [{ name: "Vanilla", rating: 0, partners: 0, manaValue: 5, reasons: ["nothing in the deck connects to it", CORE] }] } as DeckReport;
  expect(chooseCuts(old, null)).toEqual([expect.objectContaining({ name: "Vanilla", reasons: ["nothing in the deck connects to it"] })]);
});

test("the engine's arguments read in a player's words", () => {
  expect(keepWords("rates 1.3 of 5 in this deck")).toBe("it scores 1.3 for synergy, where 5 is this deck's best card");
  expect(keepWords("fills targetedRemoval")).toBe("fills targetedRemoval");
});

/** ROLE CARDS, FOR SWAPS ONLY (2026-09-27): a card whose only protection is its role can be swapped
 *  for a better card in the same role; a combo half, a listed cut or cheap ramp cannot. */
test("swap candidates are role-only cards, weakest first, never cheap ramp or a listed cut", () => {
  const report = {
    cards: [{ name: "Sol Ring", roles: ["ramp"] }, { name: "Cultivate", roles: ["ramp"] }, { name: "Despark", roles: ["targetedRemoval"] }, { name: "Combo Piece", roles: ["draw"] }, { name: "Listed", roles: [] }],
    trim: [
      { name: "Listed", rating: 0, partners: 0, manaValue: 2, reasons: [], protections: [] },
      { name: "Sol Ring", rating: 0, partners: 0, manaValue: 1, reasons: [], protections: ["fills ramp"] },
      { name: "Despark", rating: 0, partners: 1, manaValue: 2, reasons: [], protections: ["fills targetedRemoval — Interaction is at 14 against a target of 13, so there is room here"] },
      { name: "Combo Piece", rating: 0.2, partners: 3, manaValue: 3, reasons: [], protections: ["fills draw", "half of a combo"] },
      { name: "Cultivate", rating: 0.4, partners: 2, manaValue: 3, reasons: [], protections: ["fills ramp"] },
    ],
  } as unknown as DeckReport;
  const cuts = [{ name: "Listed", manaValue: 2, keeps: [], onPlan: false, unmet: [], reasons: [], twins: [] }];
  expect(swapCandidates(report, cuts)).toEqual(["Despark", "Cultivate"]);
});

/** A CUT ON A WIN PLAN SAYS SO (persona round, 2026-09-27: three of four cuts sat on the win plans
 *  two chapters up, and neither place said it). An argument to keep, not a gate. */
test("a cut that a win plan counts says so, and is still a cut", () => {
  const { report, model } = withTrim();
  const r = { ...report, deckMath: { ...report.deckMath, wincons: { focus: 1, primary: "go-wide", classes: [{ class: "go-wide", count: 1, share: 1, cards: ["Raise Once"] }] } } } as DeckReport;
  const cuts = chooseCuts(r, model);
  const raise = cuts.find((c) => c.name === "Raise Once")!;
  // The plan, and (#981) the link it would keep, so the reason names a card.
  expect(raise.keeps).toContain("it is one of the cards your win plan of attacking with a wide board counts");
  expect(raise.keeps[0]).toMatch(/^its strongest link: /);
  expect(cuts.map((c) => c.name)).toEqual(["Vanilla", "Raise Once", "Sidekick"]);
});

/** NEVER AN UNREAD LINK AS THE REASON (review 2026-10-06): "X triggers" is true and says nothing. */
test("a keep reason never names a link whose effect was not read", () => {
  const { report, model } = withTrim();
  for (const c of chooseCuts(report, model)) for (const k of c.keeps) expect(k).not.toMatch(/triggers$/);
});
