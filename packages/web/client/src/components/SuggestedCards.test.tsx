import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import type { SuggestedCard } from "@edh-seer/matcher/suggest-static";
import { SuggestedCards } from "./SuggestedCards.js";

const chaosWarp: SuggestedCard = {
  name: "Chaos Warp", slug: "chaos-warp", identity: ["R"], mv: 3,
  connections: ["Krenko, Mob Boss", "Goblin Chieftain", "Skirk Prospector"],
  reasons: ["First reason.", "Second reason.", "Third reason.", "Fourth reason."],
};
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

test("a row names the card as a link to its page, how many deck cards it connects to, and why", () => {
  inRouter(<SuggestedCards cards={[chaosWarp]} empty="none" />);
  const row = screen.getByRole("listitem");
  expect(within(row).getByRole("link", { name: "Chaos Warp" }).getAttribute("href")).toBe("/cards/chaos-warp");
  expect(row.textContent).toContain("connects to 3 of your cards");
  expect(row.textContent).toContain("Krenko, Mob Boss");
  expect(within(row).getByText("First reason.")).toBeVisible();
  expect(within(row).getByText("Second reason.")).toBeVisible();
});

test("reasons past the second are folded behind 'and N more'", () => {
  inRouter(<SuggestedCards cards={[chaosWarp]} empty="none" />);
  const details = screen.getByText("and 2 more").closest("details")!;
  expect(details.open).toBe(false);
  expect(within(details).getByText("Third reason.")).toBeInTheDocument();
  expect(within(details).getByText("Fourth reason.")).toBeInTheDocument();
});

test("an empty list says so in the given words and draws no list", () => {
  inRouter(<SuggestedCards cards={[]} empty="Nothing in your colours both fills this role and connects." />);
  expect(screen.getByText("Nothing in your colours both fills this role and connects.")).toBeInTheDocument();
  expect(screen.queryByRole("list")).toBeNull();
});

test("a card that also fits the plan says so", () => {
  inRouter(<SuggestedCards cards={[{ ...chaosWarp, alsoPlan: true }]} empty="none" />);
  expect(screen.getByText("also fits your plan")).toBeInTheDocument();
});

test("a route card's reason is the route, and the cards that reach it are listed", () => {
  const tremors: SuggestedCard = {
    name: "Impact Tremors", slug: "impact-tremors", identity: ["R"], mv: 2, connections: ["Maker One"], reasons: ["x"],
    route: { to: "Ghyrson Starn", from: ["Maker One", "Maker Two", "Maker Three"] },
  };
  inRouter(<SuggestedCards cards={[tremors]} empty="none" />);
  const row = screen.getByRole("listitem");
  expect(row.textContent).toContain("3 of your cards reach Ghyrson Starn through it");
  const details = within(row).getByText("which cards").closest("details")!;
  expect(within(details).getByText(/Maker One, Maker Two, Maker Three/)).toBeInTheDocument();
});

test("loading is a spinner at full strength that says what is happening", () => {
  inRouter(<SuggestedCards cards={undefined} empty="none" />);
  const status = screen.getByRole("status");
  expect(status.textContent).toContain("Finding cards that fit");
  expect(status.className).not.toMatch(/opacity|disabled/);
});
