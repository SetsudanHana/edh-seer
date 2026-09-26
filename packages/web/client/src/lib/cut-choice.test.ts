import { expect, test } from "vitest";
import type { DeckReport } from "../types.js";
import { buildEngineModel } from "./engine-model.js";
import { engineDeck } from "./engine-model.fixture.js";
import { chooseCuts, keepWords } from "./cut-choice.js";

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
  expect(cuts[2]!.keeps).toEqual(["its strongest link is to your main theme"]);
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
