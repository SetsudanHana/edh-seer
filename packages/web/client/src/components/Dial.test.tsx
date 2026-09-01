import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { Dial } from "./Dial.js";
import { floorState, scoreState } from "../lib/deck-gauge.js";

test("prints the name, the value and the state in words", () => {
  render(<Dial name="Interaction" value="19" reading={floorState(19, 10)} zones="floor" />);
  expect(screen.getByText("Interaction")).toBeInTheDocument();
  expect(screen.getByText("19")).toBeInTheDocument();
  // The state is TEXT, never tone alone -- WCAG 1.4.1.
  expect(screen.getByText("9 over target")).toBeInTheDocument();
});

test("is a button that opens its detail, and says so to a screen reader", async () => {
  const onOpen = vi.fn();
  render(<Dial name="Interaction" value="19" reading={floorState(19, 10)} zones="floor" onOpen={onOpen} openLabel="Build" />);
  const b = screen.getByRole("button", { name: "Interaction, 19, 9 over target — open Build" });
  fireEvent.click(b);
  expect(onOpen).toHaveBeenCalledOnce();
});

/** A dial with nowhere to go is not a button. Ramp and Board wipes are single-leaf parents and
 *  render no group on the Build tab, so they have no detail to open -- offering the affordance
 *  would be a control that does nothing. */
test("renders as plain content when there is nothing to open", () => {
  render(<Dial name="Ramp" value="17" reading={floorState(17, 10)} zones="floor" />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("Ramp")).toBeInTheDocument();
});

test("the arc itself is hidden from screen readers", () => {
  const { container } = render(<Dial name="Build" value="3.4" reading={scoreState(3.4)} zones="score" />);
  const svg = container.querySelector("svg");
  expect(svg).toHaveAttribute("aria-hidden", "true");
});

test("draws one zone per band of its kind", () => {
  const { container: floor } = render(<Dial name="A" value="1" reading={floorState(10, 10)} zones="floor" />);
  const { container: score } = render(<Dial name="B" value="1" reading={scoreState(3)} zones="score" />);
  // floor: far-under, under, on-target, room = 4. score: the product's four bands = 4.
  expect(floor.querySelectorAll("[data-zone]")).toHaveLength(4);
  expect(score.querySelectorAll("[data-zone]")).toHaveLength(4);
});
