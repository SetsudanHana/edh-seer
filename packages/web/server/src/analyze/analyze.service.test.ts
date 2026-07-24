import "reflect-metadata";
import { expect, test } from "vitest";
import { AnalyzeService } from "./analyze.service.js";
import type { AnalyzeDeps } from "./analyze.service.js";
import type { DeckReport } from "@mtg/engine";

const fakeReport: DeckReport = {
  commanders: ["Krenko, Mob Boss"],
  cards: [],
  edges: [],
  combos: [],
  themes: [],
  roles: { ramp: 0, draw: 0, removal: 0 },
  cohesion: null,
};

function fakeDeps(capture: { commanderNames?: string[] }): AnalyzeDeps {
  return {
    parseDecklistSections: (text) => {
      // "Commander\n1 X\n\n1 Y" -> { commanders:["X"], deck:["Y"] }; else all deck.
      const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
      if (lines[0]?.toLowerCase() === "commander") {
        return { commanders: [lines[1]?.replace(/^\d+\s+/, "") ?? ""], deck: lines.slice(2).map((l) => l.replace(/^\d+\s+/, "")) };
      }
      return { commanders: [], deck: lines.map((l) => l.replace(/^\d+\s+/, "")) };
    },
    parseLines: (text) => text.split("\n").map((s) => s.trim().replace(/^\d+\s+/, "")).filter(Boolean),
    makeLookup: () => ({}),
    resolveDeck: async (commanderNames, deckNames) => ({
      cards: [...commanderNames, ...deckNames].map((n) => ({ name: n })),
      combos: [],
      missing: [],
      commanderResolved: commanderNames,
    }),
    analyze: async (_cards, _combos, commanderNames) => {
      capture.commanderNames = commanderNames;
      return fakeReport;
    },
  };
}

test("explicit commanders field wins over the parsed section", async () => {
  const capture: { commanderNames?: string[] } = {};
  const svc = new AnalyzeService(fakeDeps(capture));
  const out = await svc.analyze("Commander\n1 Section Cmdr\n\n1 Sol Ring", "1 Field Cmdr");
  expect(capture.commanderNames).toEqual(["Field Cmdr"]);
  expect(out.report).toBe(fakeReport);
  expect(out.totalCount).toBe(2); // 1 field commander + 1 deck card
});

test("falls back to the parsed Commander section when the field is empty", async () => {
  const capture: { commanderNames?: string[] } = {};
  const svc = new AnalyzeService(fakeDeps(capture));
  await svc.analyze("Commander\n1 Section Cmdr\n\n1 Sol Ring", "");
  expect(capture.commanderNames).toEqual(["Section Cmdr"]);
});
