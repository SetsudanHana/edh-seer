import { render, screen } from "@testing-library/react";
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
  expect(screen.getByText(/findings, worst first/).textContent)
    .toBe(`${findings(report).length} findings, worst first`);
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
