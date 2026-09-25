import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import type { SuggestedCard } from "@edh-seer/matcher/suggest-static";
import { StrengthenLists, SuggestedCards } from "./SuggestedCards.js";

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

/** "STRENGTHEN WHAT WORKS" HAS TWO PARTS (spec §3, amended 2026-09-25): route cards first, then the
 *  plan list. A part with nothing in it is not drawn; both empty say one sentence. */
const route: SuggestedCard = {
  name: "Impact Tremors", slug: "impact-tremors", identity: ["R"], mv: 2, connections: ["Maker One"], reasons: ["x"],
  route: { to: "Ghyrson Starn", from: ["Maker One", "Maker Two"] },
};
test("routes come first under their own label, then the plan list", () => {
  inRouter(<StrengthenLists routes={[route]} plan={[chaosWarp]} />);
  const labels = screen.getAllByText(/^(Opens a route|Connects to your plan)$/).map((e) => e.textContent);
  expect(labels).toEqual(["Opens a route", "Connects to your plan"]);
  const names = screen.getAllByRole("link").map((a) => a.textContent);
  expect(names).toEqual(["Impact Tremors", "Chaos Warp"]);
});

test("an empty part draws no label", () => {
  inRouter(<StrengthenLists routes={[]} plan={[chaosWarp]} />);
  expect(screen.queryByText("Opens a route")).toBeNull();
  expect(screen.getByText("Connects to your plan")).toBeInTheDocument();
});

test("both parts empty is one sentence and no labels", () => {
  inRouter(<StrengthenLists routes={[]} plan={[]} />);
  expect(screen.queryByText("Opens a route")).toBeNull();
  expect(screen.queryByText("Connects to your plan")).toBeNull();
  expect(screen.getByText(/Nothing outside the deck connects to two or more of its cards/)).toBeInTheDocument();
});

test("while computing, the section shows the wait once", () => {
  inRouter(<StrengthenLists routes={undefined} plan={undefined} />);
  expect(screen.getAllByRole("status")).toHaveLength(1);
});

/** THE CLAIM, THEN ITS EVIDENCE (persona round 2026-09-25): under "You are 10 short on ramp" the row
 *  says the card counts as ramp before its connections argue for it, and the card's own text sits
 *  one click away so the reader can check. */
test("a card on a build list says what it counts as, first", () => {
  inRouter(<SuggestedCards cards={[{ ...chaosWarp, fills: "Ramp" }]} empty="none" />);
  const lines = [...screen.getByRole("listitem").querySelectorAll("p")].map((p) => p.textContent);
  expect(lines[0]).toBe("Counts as ramp");
});

test("a card on an answers list says what it answers", () => {
  inRouter(<SuggestedCards cards={[{ ...chaosWarp, answers: ["enchantment"] }]} empty="none" />);
  expect(screen.getByText("Answers enchantments")).toBeInTheDocument();
});

test("a card that answers two kinds names both", () => {
  inRouter(<SuggestedCards cards={[{ ...chaosWarp, answers: ["enchantment", "artifact"] }]} empty="none" />);
  expect(screen.getByText("Answers enchantments and artifacts")).toBeInTheDocument();
});

test("the card's own text is one click away", () => {
  inRouter(<SuggestedCards cards={[{ ...chaosWarp, oracle: "Target permanent's owner shuffles it into their library." }]} empty="none" />);
  const details = screen.getByText("card text").closest("details")!;
  expect(details.open).toBe(false);
  expect(within(details).getByText("Target permanent's owner shuffles it into their library.")).toBeInTheDocument();
});
