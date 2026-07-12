import "reflect-metadata";
import { expect, test } from "vitest";
import { AnalyzeService } from "./analyze.service.js";
import type { AnalyzeDeps } from "./analyze.service.js";
import type { DeckReport } from "@mtg/engine";

const fakeReport: DeckReport = {
  edges: [{ a: "Krenko, Mob Boss", b: "Impact Tremors", score: 1, reasons: [{ text: "tokens" }] }] as any,
  combos: [],
  themes: [{ tag: "token", count: 2 }],
  roles: { ramp: 0, draw: 0, removal: 0 },
};

function fakeDeps(): AnalyzeDeps {
  return {
    parseDecklistText: (text) => text.split("\n").map((s) => s.trim()).filter(Boolean),
    makeLookup: () => ({}),
    resolveNames: async (names) => ({
      cards: names.filter((n) => n !== "Nonexistent").map((n) => ({ name: n })),
      combos: [],
      missing: names.filter((n) => n === "Nonexistent"),
    }),
    analyze: () => fakeReport,
  };
}

test("resolves, analyzes, and reports counts + missing", async () => {
  const svc = new AnalyzeService(fakeDeps());
  const out = await svc.analyze("Krenko, Mob Boss\nImpact Tremors\nNonexistent");
  expect(out.report).toEqual(fakeReport);
  expect(out.missing).toEqual(["Nonexistent"]);
  expect(out.totalCount).toBe(3);
  expect(out.resolvedCount).toBe(2);
});
