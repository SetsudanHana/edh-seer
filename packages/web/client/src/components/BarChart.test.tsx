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
  const labels = screen.getAllByTestId("bar-label").map((el) => el.textContent);
  expect(labels).toContain("0");
  expect(labels).toContain("2");
});

test("names the peak", () => {
  render(<BarChart heading="Mana curve" bars={bars} formatTick={String} peakLabel={(b) => String(b.value)} />);
  expect(screen.getByTestId("peak-label")).toHaveTextContent("5");
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
  expect(container.querySelectorAll("[data-testid='bar']").length).toBe(2);
});

// THE DEFECT THIS CHART SHIPPED WITH: a fixed 400-unit viewBox under preserveAspectRatio="none",
// so every container wider than 400px stretched the drawing horizontally and left its height alone
// -- stretched glyphs, an elliptical corner radius, and gaps that grew with the container. One unit
// must be one pixel, which means the viewBox tracks the measured width and nothing overrides the
// aspect ratio. jsdom reports every box as 0 wide and never fires a ResizeObserver, so the width
// here is the pre-measure fallback.
test("draws at 1:1 and never stretches the drawing", () => {
  const { container } = render(
    <BarChart heading="Mana curve" bars={bars} formatTick={String} peakLabel={(b) => String(b.value)} />,
  );
  const svg = container.querySelector("svg")!;
  expect(svg.getAttribute("preserveAspectRatio")).toBeNull();
  expect(svg.getAttribute("viewBox")).toBe("0 0 400 132");
});

// THE DEFECT THIS CHART SHIPPED WITH: a fixed 400-unit viewBox under preserveAspectRatio="none",
// so any container wider than 400px stretched the drawing horizontally and left its height alone --
// stretched glyphs, an elliptical corner radius, and gaps that grew with the container. One unit
// must be one pixel, which means the viewBox tracks the MEASURED width and nothing overrides the
// aspect ratio. jsdom reports every box as 0 wide and never fires a ResizeObserver, so the width
// here is the pre-measure fallback.
test("draws at 1:1 and never stretches the drawing", () => {
  const { container } = render(
    <BarChart heading="Mana curve" bars={bars} formatTick={String} peakLabel={(b) => String(b.value)} />,
  );
  const svg = container.querySelector("svg")!;
  expect(svg.getAttribute("preserveAspectRatio")).toBeNull();
  expect(svg.getAttribute("viewBox")).toBe("0 0 400 132");
});

// A pointer-only chart: eight <title> tooltips and nothing an assistive reader can reach in one
// pass. The <desc> is the shape in a sentence, built from the bars so it cannot describe a chart
// other than the one drawn.
test("describes its own shape for a reader who cannot see it", () => {
  const { container } = render(
    <BarChart heading="Mana curve" bars={bars} formatTick={String} peakLabel={(b) => String(b.value)} />,
  );
  const desc = container.querySelector("svg > desc")!;
  expect(desc.textContent).toBe("3 bars, 0 to 2. Highest: 5 cards at mana value 2.");
});
