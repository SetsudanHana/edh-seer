import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import { Findings } from "./Findings.js";
import { findings } from "../lib/findings.js";
import { SAMPLE } from "../fixtures.js";

/** `SAMPLE.report` produces exactly three findings — `build:Board wipes` (`Board wipes 0/3`),
 *  `build:Ramp` (`Ramp 6/10`) and `build:Interaction` (`Interaction 8/10`). `lands` is deliberately
 *  an id this fixture does NOT produce, which is what makes it usable as a resolved one. */
const report = SAMPLE.report;

const resolvedLands = {
  added: [], removed: [], categories: [],
  findings: [{ id: "lands", label: "lands", from: "lands 30/36" }],
};

/** A FINDING THAT IS GONE IS THE STRONGEST THING THIS REPORT CAN SAY ABOUT AN EDIT (roadmap S9), and
 *  ranking is what hid it: a fixed finding vanishes and everything below it is promoted, so the
 *  surface most changed by a good edit had no memory of it. */
test("a resolved finding renders once, struck through, and is not counted", () => {
  render(<Findings report={report} diff={resolvedLands} />);
  const gone = screen.getByText("lands 30/36");
  expect(gone.closest("li")!.className).toContain("line-through");
  // The count is `findings(report).length`, which no longer contains it -- a resolved finding is not
  // a finding, and the header's own count reads the same function. Asserted on the counting SENTENCE
  // rather than on the bare number, which also matches a row's ordinal.
  expect(screen.getByText(/suggestions, biggest payoff first/).textContent)
    .toBe(`${findings(report).length} suggestions, biggest payoff first`);
});

/** It disappears by itself: the next run's diff no longer names it, so nothing tracks "shown once". */
test("a resolved finding is absent on the next run", () => {
  const { rerender } = render(<Findings report={report} diff={resolvedLands} />);
  expect(screen.getByText("lands 30/36")).toBeInTheDocument();
  rerender(<Findings report={report} diff={{ added: [], removed: [], categories: [], findings: [] }} />);
  expect(screen.queryByText("lands 30/36")).toBeNull();
});

test("a finding new since the edit is marked", () => {
  const first = findings(report)[0]!; // `build:Board wipes` for this fixture
  render(<Findings report={report} diff={{
    added: [], removed: [], categories: [],
    findings: [{ id: first.id, label: first.figureLabel, to: `${first.figureLabel} ${first.figure}` }],
  }} />);
  expect(screen.getByText("since your edit")).toBeInTheDocument();
});

/** A figure that merely MOVED gets nothing here. The header line already states the move, and a
 *  third statement of one fact is what the ranked list was built to remove. */
test("a finding whose figure only moved carries no mark", () => {
  const first = findings(report)[0]!;
  render(<Findings report={report} diff={{
    added: [], removed: [], categories: [],
    findings: [{ id: first.id, label: first.figureLabel, from: "x 1/2", to: "x 2/2" }],
  }} />);
  expect(screen.queryByText("since your edit")).toBeNull();
});

test("run one renders the list unchanged", () => {
  const { container } = render(<Findings report={report} />);
  expect(screen.queryByText("since your edit")).toBeNull();
  expect(container.querySelector(".line-through")).toBeNull();
});

// --- S10: ranked by what fixing it is worth ---

/** A report whose only problems are priceable ones, so the second group has nothing under it. */
const buildOnly = {
  ...report,
  buildParents: [{ name: "Consistency", count: 6, target: 14, leaves: ["draw"], impact: 0.635 }],
  deckMath: undefined,
  cards: [],
} as typeof report;

/** Every class covered, some held under `required`: the multiplier cannot move, so the answers
 *  finding exists and is worth exactly nothing. */
const coveredButThin = {
  ...report,
  buildParents: [],
  answersImpact: 0,
  deckMath: {
    turn: 6,
    answers: ["creature", "artifact", "enchantment", "planeswalker", "land"].map((cls) => ({
      class: cls, count: 2, required: 5, available: 0.25, exiling: 0, recurring: 0,
      fromCommandZone: false, pool: 1,
    })),
  },
} as unknown as typeof report;

/** THE RANKING IS PRINTED, because a ranked list whose order the reader cannot check from the screen
 *  it appears on is the skeptic persona's standing test. Not an arrow and not a predicted new score
 *  -- the figure the row is ranked BY. */
test("each scored row prints what fixing it is worth", () => {
  const { container } = render(<Findings report={buildOnly} />);
  // The figure sits in its own `stat-num` span, so the sentence is split across elements -- match the
  // paragraph's text rather than a single text node.
  const worth = [...container.querySelectorAll("p")].map((el) => el.textContent);
  // 0.635 prints as +0.64: two decimals, rounded, which is what the row shows.
  expect(worth).toContain("+0.64 to Build, at least");
});

test("the heading says what the order is by", () => {
  render(<Findings report={buildOnly} />);
  expect(screen.getByText(/biggest payoff first/)).toBeInTheDocument();
});

/** The second heading is absent when there is nothing under it -- a heading over an empty list is
 *  the same defect as a mark that is always present. */
test("the second heading is absent when nothing is unscored", () => {
  render(<Findings report={buildOnly} />);
  expect(screen.queryByText("What the build score cannot see")).toBeNull();
});

/** An impact of 0 renders as a statement rather than "+0.00 to Build", which reads as a rounding
 *  error rather than as the claim it is. */
test("a zero impact says so in words", () => {
  render(<Findings report={coveredButThin} />);
  expect(screen.getByText("won't change your Build score")).toBeInTheDocument();
});

/** EVERY FINDING A CARD CAN FIX NAMES THE CARDS (spec §3, AO4), directly under its own row; a mana
 *  finding keeps its sentence and gets none, because lands are out of scope. */
const chaosWarp = { name: "Chaos Warp", slug: "chaos-warp", identity: ["R"], mv: 3, connections: ["Krenko, Mob Boss"], reasons: [{ text: "Chaos Warp answers what Krenko cannot.", others: [] }] };
const noCards = { build: {}, answers: {}, synergy: {}, plan: [], pairs: [], routes: [] };
const withLands = { ...report, deckMath: { ...report.deckMath, lands: { actual: 30, target: 37, avgManaValue: 3 } } } as typeof report;

test("a build finding lists its cards under its own row", () => {
  render(<MemoryRouter><Findings report={report} suggestions={{ state: "ready", value: { ...noCards, build: { Interaction: [chaosWarp] } } }} /></MemoryRouter>);
  const row = screen.getByText(/short on interaction/).closest("li")!;
  expect(within(row).getByRole("link", { name: "Chaos Warp" })).toBeInTheDocument();
  expect(within(row).getByText("Cards that fit")).toBeInTheDocument();
});

test("a lands finding lists no cards, even while the rest are loading", () => {
  render(<MemoryRouter><Findings report={withLands} suggestions={{ state: "loading", value: null }} /></MemoryRouter>);
  const fold = screen.queryByRole("button", { name: /^Show \d+ smaller/ });
  if (fold) fireEvent.click(fold);
  const row = screen.getByText(/lands short/).closest("li")!;
  expect(within(row).queryByRole("status")).toBeNull();
  expect(within(row).queryByText("Cards that fit")).toBeNull();
  // ...while a build row in the same list shows the wait.
  expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
});

test("a failed suggestion run leaves the findings as they were", () => {
  render(<MemoryRouter><Findings report={report} suggestions={{ state: "error", value: null }} /></MemoryRouter>);
  expect(screen.queryByText("Cards that fit")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

/** A CROSS-JOB SWAP SITS WITH THE FINDINGS, under "where to find the slots"; a same-job swap is the
 *  cut list's, one movement down (spec §3). */
test("cross-job swaps render with the findings, same-job swaps do not", () => {
  const pairs = [
    { cut: "Mind Stone", add: chaosWarp, rule: "cross-job" as const, cutConnections: 1, counts: [{ group: "Ramp", from: 11, to: 10 }] },
    { cut: "Murder", add: { ...chaosWarp, name: "Terminate", slug: "terminate" }, rule: "same-job" as const, cutConnections: 0, counts: [] },
  ];
  render(<MemoryRouter><Findings report={report} suggestions={{ state: "ready", value: { ...noCards, pairs } }} /></MemoryRouter>);
  expect(screen.getByRole("link", { name: "Chaos Warp" }).closest("li")!.textContent).toMatch(/^Replace Mind Stone with Chaos Warp/);
  expect(screen.queryByRole("link", { name: "Terminate" })).toBeNull();
});
