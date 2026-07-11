import { expect, test } from "vitest";
import { analyzeDeck, FIXTURES } from "@mtg/engine";
import { formatReport } from "./report.js";

test("formatReport renders sections for a small deck", () => {
  const report = analyzeDeck([FIXTURES.krenko, FIXTURES.impactTremors]);
  const out = formatReport(report);
  expect(out).toContain("Top synergies");
  expect(out).toContain("Krenko, Mob Boss");
  expect(out).toContain("Roles");
});
