import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { RoleBars } from "./RoleBars.js";

const BARS = [
  { role: "Consistency", count: 15 },
  { role: "Ramp", count: 17 },
  { role: "Interaction", count: 19 },
  { role: "Board wipes", count: 1 },
];

test("every bar prints its own count, not a ratio against a target", () => {
  render(<RoleBars bars={BARS} />);
  for (const b of BARS) {
    expect(screen.getByTestId(`role-row-${b.role}`)).toHaveTextContent(String(b.count));
  }
  // A target would put the judgement back into the recognition step.
  expect(screen.queryByText(/\/\s*10/)).toBeNull();
});

test("bar widths are proportional to the largest count", () => {
  render(<RoleBars bars={BARS} />);
  const widest = screen.getByTestId("role-bar-Interaction");
  const narrow = screen.getByTestId("role-bar-Board wipes");
  expect(parseFloat(widest.style.width)).toBeGreaterThan(parseFloat(narrow.style.width));
  expect(parseFloat(widest.style.width)).toBe(100);
});

test("no bars renders nothing", () => {
  const { container } = render(<RoleBars bars={[]} />);
  expect(container.firstChild).toBeNull();
});
