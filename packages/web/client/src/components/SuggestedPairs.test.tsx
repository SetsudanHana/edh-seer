import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import type { SuggestedPair } from "@edh-seer/matcher/suggest-static";
import { SwapLine } from "./SuggestedPairs.js";

const chaosWarp = { name: "Chaos Warp", slug: "chaos-warp", identity: ["R"], mv: 3, connections: ["A", "B", "C", "D"], reasons: [{ text: "Chaos Warp answers what the deck cannot.", others: [] }] };
const crossJob: SuggestedPair = {
  cut: "Mind Stone", add: chaosWarp, rule: "cross-job", cutConnections: 1, cutStrength: { strength: 1, partners: 1, onTheme: 0, commander: false }, addStrength: { strength: 2, partners: 4, onTheme: 1, commander: false },
  counts: [{ group: "Ramp", from: 13, to: 12 }, { group: "Interaction", from: 7, to: 8 }],
};
const sameJob: SuggestedPair = { cut: "Murder", add: chaosWarp, rule: "same-job", cutConnections: 0, cutStrength: { strength: 1, partners: 0, onTheme: 0, commander: false }, addStrength: { strength: 2, partners: 4, onTheme: 1, commander: false }, counts: [] };
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

test("a cross-job swap says what comes in, and both group counts in order", () => {
  inRouter(<SwapLine p={crossJob} />);
  const line = screen.getByTestId("swap");
  expect(line.textContent).toContain("Ramp 13 to 12, Interaction 7 to 8");
  expect(line.textContent).toContain("works with 4 of your cards");
  expect(line.textContent).toContain("Chaos Warp answers what the deck cannot.");
  expect(screen.getByRole("link", { name: "Chaos Warp" }).getAttribute("href")).toBe("/cards/chaos-warp");
});

test("a same-job swap prints no group counts, and its arrows are decoration", () => {
  const { container } = inRouter(<SwapLine p={sameJob} />);
  expect(screen.getByTestId("swap").textContent).not.toMatch(/Ramp|Interaction/);
  for (const svg of container.querySelectorAll("svg")) expect(svg.getAttribute("aria-hidden")).toBe("true");
});
