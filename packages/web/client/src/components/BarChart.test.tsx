import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { BarChart } from "./BarChart.js";

const bars = [
  { label: "0", value: 1, title: "1 card at mana value 0" },
  { label: "1", value: 0, title: "0 cards at mana value 1" },
  { label: "2", value: 5, title: "5 cards at mana value 2" },
];

test("renders one bar per datum, labelled", () => {
  render(<BarChart heading="Mana curve" bars={bars} formatTick={String} peakLabel={(b) => String(b.value)} />);
  expect(screen.getByText("0")).toBeInTheDocument();
  expect(screen.getByText("2")).toBeInTheDocument();
});

test("names the peak", () => {
  render(<BarChart heading="Mana curve" bars={bars} formatTick={String} peakLabel={(b) => String(b.value)} />);
  expect(screen.getByText("5")).toBeInTheDocument();
});

// The gain over the flexbox version being replaced: these charts had no axis at all, so a bar's
// height was readable only relative to its neighbours.
test("draws a y-axis with ticks spanning the data", () => {
  const { container } = render(
    <BarChart heading="Mana curve" bars={bars} formatTick={String} peakLabel={(b) => String(b.value)} />,
  );
  const ticks = container.querySelectorAll("[data-testid='y-tick']");
  expect(ticks.length).toBeGreaterThan(1);
});

test("a zero-valued bar still gets its label and title", () => {
  render(<BarChart heading="Mana curve" bars={bars} formatTick={String} peakLabel={(b) => String(b.value)} />);
  expect(screen.getByTitle("0 cards at mana value 1")).toBeInTheDocument();
});

// An all-zero dataset must not divide by zero and must not vanish.
test("survives an all-zero dataset", () => {
  const zeros = [{ label: "0", value: 0, title: "none" }, { label: "1", value: 0, title: "none" }];
  const { container } = render(
    <BarChart heading="Empty" bars={zeros} formatTick={String} peakLabel={(b) => String(b.value)} />,
  );
  expect(container.querySelectorAll("rect").length).toBe(2);
});
