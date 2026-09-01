import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { TypeDonut } from "./TypeDonut.js";

const SLICES = [
  { type: "creature", count: 22 },
  { type: "enchantment", count: 32 },
  { type: "artifact", count: 8 },
];

test("prints the nonland total in the hole, which is what makes the slices checkable", () => {
  render(<TypeDonut slices={SLICES} />);
  expect(screen.getByTestId("donut-total")).toHaveTextContent("62");
});

test("every slice is directly labelled, so identity is never colour alone", () => {
  render(<TypeDonut slices={SLICES} />);
  for (const s of SLICES) {
    expect(screen.getByTestId(`donut-legend-${s.type}`)).toHaveTextContent(String(s.count));
  }
});

test("renders one arc per slice", () => {
  render(<TypeDonut slices={SLICES} />);
  expect(screen.getAllByTestId("donut-arc")).toHaveLength(3);
});

test("an empty deck renders no chart rather than an empty ring", () => {
  const { container } = render(<TypeDonut slices={[]} />);
  expect(container.querySelector("svg")).toBeNull();
});
