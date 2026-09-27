import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { Finding } from "../lib/findings.js";
import { SAMPLE } from "../fixtures.js";

const colour: Finding = {
  kind: "colour", id: "colour:W", headline: "Your white cards want more white sources early.",
  detail: "12 of 22 white sources by turn 2.", figure: "12/22", figureLabel: "White", filled: 0.5, shortfall: 0.5,
};

vi.mock("../lib/findings.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/findings.js")>();
  return { ...real, rankedFindings: () => ({ scored: [], unseen: [colour] }), slotTrade: () => null };
});

const { Findings } = await import("./Findings.js");

/** THE HEADER COUNTS BOTH GROUPS (deck-build round, 2026-09-27): an Inalla list whose only
 *  suggestion was outside the Build score read "1 SUGGESTION ↓" over a chapter that showed none. */
test("a deck whose only suggestion is outside the Build score still shows it", () => {
  render(<Findings report={SAMPLE.report} />);
  expect(screen.getByText(/suggestion, biggest payoff first/).textContent).toBe("1 suggestion, biggest payoff first");
  expect(screen.getByRole("heading", { name: "Not counted in your Build score" })).toBeInTheDocument();
  expect(screen.getByText(colour.headline)).toBeInTheDocument();
});
