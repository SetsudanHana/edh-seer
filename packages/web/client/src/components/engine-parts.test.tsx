import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Badge } from "./engine-parts.js";

/** "Do this only once each turn" is not "every time" (issue #518, Terrasymbiosis). */
test("a repeating link capped once a turn reads 'once a turn'; the mark means nothing on a one-shot", () => {
  render(<><Badge repeat="triggered" perTurn /><Badge repeat="triggered" /><Badge repeat="oneshot" perTurn /></>);
  expect(screen.getByText("once a turn")).toBeTruthy();
  expect(screen.getByText("each time")).toBeTruthy();
  expect(screen.getByText("only once")).toBeTruthy();
});
