import { expect, test } from "vitest";
import { rankTable } from "./compare-core.js";
import type { DeckReport } from "@mtg/engine";

const report = (order: string[]): DeckReport => ({
  commanders: [],
  cards: order.map((name, i) => ({ name, isCommander: false, score: order.length - i, partnerCount: 1, topPartners: [] })),
  edges: [],
  combos: [],
  themes: [],
  roles: { ramp: 0, draw: 0, removal: 0 },
  cohesion: null,
});

test("rankTable lists both engines' top-N in a two-column layout", () => {
  const out = rankTable(report(["A", "B"]), report(["B", "A"]), 2);
  expect(out).toContain("FLAT");
  expect(out).toContain("STRUCTURED");
  expect(out).toContain("A");
  expect(out).toContain("B");
  expect(out.split("\n").length).toBeGreaterThanOrEqual(3);
});
