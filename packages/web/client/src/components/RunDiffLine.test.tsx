import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { RunDiffLine, signed } from "./RunDiffLine.js";
import type { RunDiff } from "../lib/run-diff.js";

const diff: RunDiff = {
  added: ["Rhystic Study", "Mystic Remora"],
  removed: ["Divination"],
  synergy: { from: 3.1, to: 3.4 },
  build: { from: 4.3, to: 4.1 },
  theme: { from: "artifacts", to: "spellslinger" },
  categories: [{ category: "cardDraw", from: 6, to: 8 }],
  findings: [{ id: "build:Consistency", label: "Consistency", from: "Consistency 6/14" }],
};

test("names what moved: the finding, the theme and the cards", () => {
  render(<RunDiffLine diff={diff} />);
  expect(screen.getByText("Consistency")).toBeInTheDocument();
  expect(screen.getByText("fixed")).toBeInTheDocument();
  expect(screen.getByText(/spellslinger/)).toBeInTheDocument();
  expect(screen.getByText(/Rhystic Study, Mystic Remora/)).toBeInTheDocument();
  expect(screen.getByText(/Divination/)).toBeInTheDocument();
});

/** THE SCORES ARE THE HEADER'S OWN, not this line's. They render as a delta beside each number one
 *  element over; restating them here would be the third statement of one fact on one bar. */
test("does not restate the scores", () => {
  render(<RunDiffLine diff={diff} />);
  expect(screen.queryByText(/3\.1/)).toBeNull();
  expect(screen.queryByText(/4\.3/)).toBeNull();
});

test("renders nothing at all without a diff", () => {
  const { container } = render(<RunDiffLine diff={null} />);
  expect(container).toBeEmptyDOMElement();
});

/** A FULL FOLD COSTS STICKY HEIGHT AT 390px FOR THE WHOLE RUN, and S15 spent an item buying that
 *  height back. The dismissal is the guard. */
test("dismissing removes the line", async () => {
  render(<RunDiffLine diff={diff} />);
  await userEvent.click(screen.getByRole("button", { name: "Dismiss what changed" }));
  expect(screen.queryByText("Consistency")).toBeNull();
});

/** The dismissal remembers WHICH diff was dismissed rather than a boolean, so the next run brings
 *  the line back with no reset call and no effect. */
test("a new run brings the line back after a dismissal", async () => {
  const { rerender } = render(<RunDiffLine diff={diff} />);
  await userEvent.click(screen.getByRole("button", { name: "Dismiss what changed" }));
  expect(screen.queryByText("Consistency")).toBeNull();
  rerender(<RunDiffLine diff={{ ...diff }} />);
  expect(screen.getByText("Consistency")).toBeInTheDocument();
});

test("signed prints an explicit plus", () => {
  expect(signed(3.1, 3.4)).toBe("+0.3");
  expect(signed(4.3, 4.1)).toBe("-0.2");
});
