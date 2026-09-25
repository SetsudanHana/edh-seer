import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import type { SuggestedPair } from "@edh-seer/matcher/suggest-static";
import { SuggestedPairs } from "./SuggestedPairs.js";

const chaosWarp = { name: "Chaos Warp", slug: "chaos-warp", identity: ["R"], mv: 3, connections: ["A", "B", "C", "D"], reasons: ["Chaos Warp answers what the deck cannot."] };
const crossJob: SuggestedPair = {
  cut: "Mind Stone", add: chaosWarp, rule: "cross-job", cutConnections: 1,
  counts: [{ group: "Ramp", from: 13, to: 12 }, { group: "Interaction", from: 7, to: 8 }],
};
const sameJob: SuggestedPair = { cut: "Murder", add: chaosWarp, rule: "same-job", cutConnections: 0, counts: [] };
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

test("a cross-job pair says what goes, what comes in, and both group counts in order", () => {
  inRouter(<SuggestedPairs pairs={[crossJob]} />);
  const row = screen.getByRole("listitem");
  expect(row.textContent).toContain("Ramp 13 to 12, Interaction 7 to 8");
  expect(row.textContent).toContain("connections 1 to 4");
  expect(screen.getByRole("link", { name: "Chaos Warp" }).getAttribute("href")).toBe("/cards/chaos-warp");
});

test("a same-job pair prints no group counts", () => {
  inRouter(<SuggestedPairs pairs={[sameJob]} />);
  expect(screen.getByRole("listitem").textContent).not.toMatch(/Ramp|Interaction/);
});

test("the pair reads as a sentence to a screen reader; the arrows are decoration", () => {
  const { container } = inRouter(<SuggestedPairs pairs={[crossJob]} />);
  expect(screen.getByRole("listitem").textContent).toMatch(/^Replace Mind Stone with Chaos Warp/);
  for (const svg of container.querySelectorAll("svg")) expect(svg.getAttribute("aria-hidden")).toBe("true");
});

test("no pairs draws nothing at all, not even a heading", () => {
  const { container } = inRouter(<SuggestedPairs pairs={[]} />);
  expect(container.innerHTML).toBe("");
});
