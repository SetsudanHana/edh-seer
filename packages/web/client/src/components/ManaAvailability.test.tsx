import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ManaAvailability } from "./ManaAvailability.js";

const rows = [1, 2, 3, 4, 5, 6].map((turn) => ({
  turn,
  mana: { median: turn, p25: turn, p75: turn },
  payableShare: { median: turn / 10, p25: turn / 20, p75: turn / 8 },
}));
const MA = { trials: 2000, accelerants: 9, rows, headline: { mana: 6, turn: 6, low: 0.4, high: 0.44 } };

/** EVERY CHART HAS ITS AXIS AND A READOUT (owner, 2026-09-06). The share axis is the whole 0-100%
 *  range; the readout defaults to the headline's turn and follows the pointer or the focus. */
test("it draws a share axis and a readout that follows hover and focus", () => {
  const { container } = render(<ManaAvailability manaAvailability={MA} />);
  expect(container.querySelectorAll("[data-testid='y-tick']").length).toBe(3);
  expect(screen.getByTestId("availability-readout")).toHaveTextContent("Turn 6 · 60% of the deck payable (30%–75%)");
  fireEvent.pointerEnter(screen.getByTestId("availability-col-3"));
  expect(screen.getByTestId("availability-readout")).toHaveTextContent("Turn 3 · 30% of the deck payable (15%–38%)");
  fireEvent.focus(screen.getByTestId("availability-col-1"));
  expect(screen.getByTestId("availability-readout")).toHaveTextContent("Turn 1 · 10%");
});
