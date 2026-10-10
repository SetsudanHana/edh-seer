import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { DeckReport } from "../types.js";
import { rankedFindings } from "../lib/findings.js";
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

const overLands = (impact: number) => ({
  ...SAMPLE.report,
  buildParents: [{ name: "Ramp", key: "ramp", count: 8, target: 10, impact, leaves: ["Ramp"] }],
  suggestions: ["Ramp 8/10 — add ~2 ramp"],
  slack: [],
  deckMath: { lands: { actual: 41, target: 36, avgManaValue: 3 } },
  landsImpact: 20,
}) as unknown as DeckReport;

test("a short role leads even when another scored finding outranks it", () => {
  const r = overLands(2);
  expect(rankedFindings(r).scored[0]!.kind).toBe("lands");
  render(<PanelVerdict report={r} />);
  expect(screen.getByText("You are 2 short on ramp.")).toBeInTheDocument();
  expect(screen.queryByText(/more lands than this curve needs/)).toBeNull();
});

test("no short role: the top scored finding", () => {
  const r = { ...overLands(2), buildParents: [] } as unknown as DeckReport;
  render(<PanelVerdict report={r} />);
  expect(screen.getByText(/more lands than this curve needs/)).toBeInTheDocument();
});

test("no button by default", () => {
  render(<PanelVerdict report={gisa} />);
  expect(screen.queryByRole("button")).toBeNull();
});

test("the button scrolls to Improve and leaves the hash alone", () => {
  const target = document.createElement("div");
  target.id = "fix";
  const spy = vi.fn();
  target.scrollIntoView = spy;
  document.body.appendChild(target);
  const hash = window.location.hash;
  render(<PanelVerdict report={gisa} withButton />);
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
