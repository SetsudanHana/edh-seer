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

/** A SNAPSHOT ENTRY IS "LABEL FIGURE" and this line prints the label itself, so all three branches
 *  have to split. Observed live 2026-09-02 reading "new Board wipes Board wipes 0/1": the moved
 *  branch had always split and the other two never had, because nothing had looked at the line with
 *  a finding that appeared or went away. */
test("a finding that appeared or went away names its label once", () => {
  render(<RunDiffLine diff={{
    added: [], removed: [], categories: [],
    findings: [
      { id: "a", label: "Board wipes", to: "Board wipes 0/1" },
      { id: "b", label: "Consistency", from: "Consistency 6/14" },
    ],
  }} />);
  expect(screen.getByText("0/1")).toBeInTheDocument();
  expect(screen.getByText("6/14")).toBeInTheDocument();
  expect(screen.queryByText(/Board wipes Board wipes/)).toBeNull();
  expect(screen.queryByText(/Consistency Consistency/)).toBeNull();
});

/** THE PHONE CUT, PINNED AS A CONTRACT rather than as a layout measurement, which jsdom cannot make.
 *  The real check is the number in the roadmap line: at 390px the wrapping version measured 235px of
 *  sticky header, 28% of an 844px viewport, on every surface. What this test can hold is that the
 *  tail is cut in CSS and the first part never is -- if someone deletes the `hidden sm:flex`, the
 *  measurement that justified it is no longer being honoured. */
test("only the first part survives below the sm breakpoint", () => {
  const { container } = render(<RunDiffLine diff={diff} />);
  const parts = [...container.querySelectorAll("p > span")].filter(s => !s.className.includes("eyebrow"));
  expect(parts[0]!.className).toContain("flex");
  expect(parts[0]!.className).not.toContain("hidden");
  expect(parts.slice(1).every(s => s.className.includes("hidden sm:flex"))).toBe(true);
  // And the row itself may not wrap on a phone: the wrap was the cost, not the content.
  expect(container.querySelector("p")!.className).toContain("flex-nowrap sm:flex-wrap");
});
