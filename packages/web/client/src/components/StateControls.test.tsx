import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { StateControls } from "./StateControls.js";

/** A GAME STATE THE OWNER SETS (roadmap W18). Speed is the player's, 1 to 4 (CR 702.179); "none"
 *  is the deck before any engine card is out, which is the report as it always was. */
test("the speed control offers none and 1 to 4, marks the current one, and reports a pick", async () => {
  const onSpeed = vi.fn();
  render(<StateControls markers={["speed"]} speed={2} onSpeed={onSpeed} />);
  expect(screen.getByRole("group", { name: /speed/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("button", { name: "4" }));
  expect(onSpeed).toHaveBeenCalledWith(4);
  await userEvent.click(screen.getByRole("button", { name: /none/i }));
  expect(onSpeed).toHaveBeenCalledWith(undefined);
});

test("a deck that reaches no marker gets no control", () => {
  const { container } = render(<StateControls markers={[]} onSpeed={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});
