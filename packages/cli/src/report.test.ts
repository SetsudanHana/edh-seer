import { expect, test } from "vitest";
import type { DeckReport } from "@mtg/engine";
import { formatReport } from "./report.js";

const report: DeckReport = {
  commanders: ["Krenko, Mob Boss"],
  cards: [
    {
      name: "Krenko, Mob Boss",
      isCommander: true,
      score: 6,
      partnerCount: 2,
      topPartners: [{ name: "Impact Tremors", score: 2, reasons: [{ tag: "token", text: "Krenko makes tokens; Impact Tremors pays off tokens." }] }],
    },
    {
      name: "Impact Tremors",
      isCommander: false,
      score: 2,
      partnerCount: 1,
      topPartners: [{ name: "Krenko, Mob Boss", score: 2, reasons: [{ tag: "token", text: "Krenko makes tokens; Impact Tremors pays off tokens." }] }],
    },
  ],
  edges: [],
  combos: [{ cards: ["A", "B"], result: "Win" }],
  themes: [{ tag: "token", count: 2 }],
  roles: { ramp: 1, draw: 0, removal: 0 },
  cohesion: { theme: "Goblins", tag: "tribe:goblin", score: 0.5, label: "focused" },
};

test("formatReport shows commanders, ranked cards with partner counts, and reasons", () => {
  const out = formatReport(report);
  expect(out).toContain("Krenko, Mob Boss");
  expect(out).toMatch(/commander/i);
  expect(out).toContain("synergizes with 2");
  expect(out).toContain("pays off tokens");
  expect(out).toContain("Win"); // combo still rendered
  expect(out).toContain("token: 2"); // themes still rendered
  expect(out).toContain("Deck cohesion");
  expect(out).toContain("Goblins");
  expect(out).toContain("0.50 (focused)");
  expect(out).toContain("[6.00]"); // score now formatted to 2 decimals
});

test("formatReport renders a placeholder when cohesion is null", () => {
  const out = formatReport({ ...report, cohesion: null });
  expect(out).toContain("=== Deck cohesion ===");
  expect(out).toContain("(no themes)");
});
