import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ManaTimeline } from "./ManaTimeline.js";

const rows = [1, 2, 3, 4, 5, 5, 6, 6].map((m, i) => ({
  turn: i + 1,
  mana: { median: m, p25: Math.max(1, m - 1), p75: m + 1 },
  payableShare: { median: 0, p25: 0, p75: 0 },
}));
const CURVE = [
  { value: 1, count: 5 }, { value: 2, count: 14 }, { value: 3, count: 19 },
  { value: 4, count: 12 }, { value: 5, count: 4 }, { value: 6, count: 4 }, { value: 7, count: 5 },
];
const MA = { trials: 2000, accelerants: 9, rows, headline: { mana: 6, turn: 6, low: 0.4, high: 0.44 } };

// A COST SITS ON THE TURN THIS DECK COVERS IT, not on the turn its number matches. The median
// stalls at 5 through turn 6, so nothing new becomes payable there.
test("a turn the median does not advance gets no bar", () => {
  render(<ManaTimeline curve={CURVE} manaAvailability={MA} />);
  expect(screen.queryByTestId("timeline-bar-6")).toBeNull();
  expect(screen.getByTestId("timeline-bar-7")).toBeInTheDocument();
});

// THE WORST INTERSECTION, and stranded cards outrank a busy turn: a turn where a lot arrives is a
// deck working; a cost the deck never covers is a card that does not get cast.
test("it names the cards the deck never pays for, over the busiest turn", () => {
  render(<ManaTimeline curve={CURVE} manaAvailability={MA} />);
  expect(screen.getByText(/5 cards cost more than this deck/)).toBeInTheDocument();
  expect(screen.queryByText(/is where the most arrives/)).toBeNull();
});

// A PANEL THAT ALWAYS HAS A COMPLAINT IS NOT READ AS ONE.
test("a deck whose mana covers its whole curve is told nothing at all", () => {
  render(
    <ManaTimeline
      curve={[{ value: 1, count: 2 }, { value: 2, count: 3 }]}
      manaAvailability={{ ...MA, rows: rows.slice(0, 3) }}
    />,
  );
  expect(screen.queryByText(/cost more than this deck/)).toBeNull();
  expect(screen.queryByText(/is where the most arrives/)).toBeNull();
});

// THE WHOLE CHART IS ONE IMAGE TO A SCREEN READER, carrying every figure a sighted reader gets by
// looking -- including the stranded cards, which are the point.
test("the chart reads out its own turns and what it strands", () => {
  render(<ManaTimeline curve={CURVE} manaAvailability={MA} />);
  const label = screen.getByRole("img").getAttribute("aria-label")!;
  expect(label).toContain("turn 3: 3 mana, 19 cards become payable");
  expect(label).toContain("5 cards cost more than the median makes by turn 8");
});

test("no simulation means no chart, never an empty one", () => {
  const { container } = render(<ManaTimeline curve={CURVE} manaAvailability={undefined} />);
  expect(container).toBeEmptyDOMElement();
});

/** EVERY CHART HAS ITS AXIS AND A READOUT (owner, 2026-09-06: "some charts have Y axis and some
 *  dont, even if I hover over a dot on the diagram I can not see the Y value"). */
test("it draws a mana axis, and hovering, tapping or focusing a turn puts its values in the readout", () => {
  const { container } = render(<ManaTimeline curve={CURVE} manaAvailability={MA} />);
  expect(container.querySelectorAll("[data-testid='y-tick']").length).toBeGreaterThan(1);
  // The busiest turn is the default, so the line is never blank.
  expect(screen.getByTestId("timeline-readout")).toHaveTextContent(/^Turn \d+ · /);
  fireEvent.pointerEnter(screen.getByTestId("timeline-col-4"));
  expect(screen.getByTestId("timeline-readout")).toHaveTextContent("Turn 4 · 4 mana in the median game (3–5)");
  fireEvent.focus(screen.getByTestId("timeline-col-2"));
  expect(screen.getByTestId("timeline-readout")).toHaveTextContent("Turn 2 · 2 mana");
});
