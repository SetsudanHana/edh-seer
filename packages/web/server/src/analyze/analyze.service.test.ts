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
  manaCurve: [
    { value: 0, count: 0 },
    { value: 1, count: 0 },
    { value: 2, count: 0 },
    { value: 3, count: 0 },
    { value: 4, count: 0 },
    { value: 5, count: 0 },
    { value: 6, count: 0 },
    { value: 7, count: 0 },
  ],
  landCount: 0,
  avgManaValue: 0,
  medianManaValue: 0,
};

function fakeDeps(capture: {
  commanderNames?: string[];
  rolesByName?: Map<string, string[]>;
  copies?: Map<string, number>;
}): AnalyzeDeps {
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
      commanderColorIdentity: ["R"],
    }),
    graph: async (_cardNames, rolesByName, copiesByName) => {
      capture.rolesByName = rolesByName;
      capture.copies = copiesByName;
      return { nodes: [], edges: [], undirectedReasons: 0, offDeckReasons: 0 };
    },
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
  expect(out.commanderColorIdentity).toEqual(["R"]);
});

test("falls back to the parsed Commander section when the field is empty", async () => {
  const capture: { commanderNames?: string[] } = {};
  const svc = new AnalyzeService(fakeDeps(capture));
  await svc.analyze("Commander\n1 Section Cmdr\n\n1 Sol Ring", "");
  expect(capture.commanderNames).toEqual(["Section Cmdr"]);
});

test("passes the graph dep a rolesByName map built from the report's cards, roleless cards excluded", async () => {
  const capture: { rolesByName?: Map<string, string[]> } = {};
  const deps = fakeDeps(capture);
  deps.analyze = async () => ({
    ...fakeReport,
    cards: [
      { name: "Sol Ring", isCommander: false, score: 0, partnerCount: 0, topPartners: [], roles: ["ramp"] },
      { name: "Krenko, Mob Boss", isCommander: true, score: 0, partnerCount: 0, topPartners: [] }, // no roles
      { name: "Forest", isCommander: false, score: 0, partnerCount: 0, topPartners: [], roles: [] }, // empty roles
    ],
  });
  const svc = new AnalyzeService(deps);
  await svc.analyze("1 Sol Ring\n1 Forest", "1 Krenko, Mob Boss");
  expect(capture.rolesByName).toEqual(new Map([["Sol Ring", ["ramp"]]]));
});

test("tells the graph dep how many copies of each card the deck holds", async () => {
  const capture: { copies?: Map<string, number> } = {};
  const deps = fakeDeps(capture);
  // resolveDeck returns one entry per copy -- 3 Mountains is three entries, one name
  deps.resolveDeck = async () => ({
    cards: [{ name: "Mountain" }, { name: "Mountain" }, { name: "Mountain" }, { name: "Sol Ring" }],
    combos: [], missing: [], commanderResolved: [], commanderColorIdentity: [],
  }) as never;
  await new AnalyzeService(deps).analyze("3 Mountain\n1 Sol Ring");
  expect(capture.copies).toEqual(new Map([["Mountain", 3], ["Sol Ring", 1]]));
});
