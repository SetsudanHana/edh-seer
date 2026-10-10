import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { DeckReport } from "../types.js";
import { SAMPLE } from "../fixtures.js";
import { PanelVerdict } from "./PanelVerdict.js";

const gisa = {
  ...SAMPLE.report,
  buildParents: [{ name: "Card advantage", key: "consistency", count: 5, target: 8, impact: 9, leaves: ["Card advantage"] }],
  suggestions: ["Card advantage 5/8 — add ~3 cards that draw"],
  slack: [],
} as unknown as DeckReport;
const clean = { ...SAMPLE.report, buildParents: [], suggestions: [], slack: [] } as unknown as DeckReport;

afterEach(() => document.getElementById("fix")?.remove());

test("leads with the one fix: eyebrow, headline, action", () => {
  render(<PanelVerdict report={gisa} />);
  expect(screen.getByText("Fix this first")).toBeInTheDocument();
  expect(screen.getByText("You will run out of cards before you run out of turns.")).toBeInTheDocument();
  expect(screen.getByText(/Add ~3 cards that draw/)).toBeInTheDocument();
});

test("nothing renders with no scored finding", () => {
  const { container } = render(<PanelVerdict report={clean} />);
  expect(container).toBeEmptyDOMElement();
});

test("the button scrolls to Improve and leaves the hash alone", () => {
  const target = document.createElement("div");
  target.id = "fix";
  const spy = vi.fn();
  target.scrollIntoView = spy;
  document.body.appendChild(target);
  const hash = window.location.hash;
  render(<PanelVerdict report={gisa} />);
  fireEvent.click(screen.getByRole("button", { name: /See all 1 suggestion/ }));
  expect(spy).toHaveBeenCalled();
  expect(window.location.hash).toBe(hash);
});

test("Glance: the verdict precedes the table sentence in all three places", () => {
  const src = readFileSync(join(__dirname, "ReportChapters.tsx"), "utf8");
  const read = src.slice(src.indexOf('<Chapter id="read"'), src.indexOf('<Chapter id="stand"'));
  const talkFirst = read.slice(read.indexOf("lead={talkFirst"), read.indexOf(") : talkInRail"));
  const inRail = read.slice(read.indexOf(") : talkInRail"), read.indexOf("leadTarget"));
  const grid = read.slice(read.indexOf("lg:grid-cols-"));
  for (const part of [talkFirst, inRail, grid]) {
    expect(part).toContain("<PanelVerdict");
    expect(part.indexOf("<PanelVerdict")).toBeLessThan(part.indexOf("<TableTalkLine"));
  }
  // verdict -> table sentence -> identity in the lead branches.
  for (const part of [talkFirst, inRail]) {
    expect(part.indexOf("<TableTalkLine")).toBeLessThan(part.indexOf('part="identity"'));
  }
});
