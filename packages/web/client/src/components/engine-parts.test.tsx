import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Badge, ReadCards } from "./engine-parts.js";

/** "Do this only once each turn" is not "every time" (issue #518, Terrasymbiosis). */
test("a repeating link capped once a turn reads 'once a turn'; the mark means nothing on a one-shot", () => {
  render(<><Badge repeat="triggered" perTurn /><Badge repeat="triggered" /><Badge repeat="oneshot" perTurn /></>);
  expect(screen.getByText("once a turn")).toBeTruthy();
  expect(screen.getByText("each time")).toBeTruthy();
  expect(screen.getByText("only once")).toBeTruthy();
});

/** THE COMMANDER'S TEXT IS OPEN WHERE THERE IS ROOM (#983): shut, it sat at the fold and was cut at
 *  "Whenever The Rani"; pod-fit could not test a true claim because the text was hidden. */
test("ReadCards can open by default, and stays shut otherwise", () => {
  const card = { id: "The Rani", name: "The Rani", text: "Whenever The Rani attacks…", typeLine: "Legendary Creature" } as never;
  const { container, rerender } = render(<ReadCards cards={[card]} open />);
  expect(container.querySelector("details")!.open).toBe(true);
  rerender(<ReadCards cards={[card]} />);
  expect(container.querySelector("details")!.open).toBe(false);
});
