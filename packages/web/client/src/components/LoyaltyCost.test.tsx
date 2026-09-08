import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { isLoyaltyCost, LoyaltyCost } from "./LoyaltyCost.js";

/** THE PRINTED BADGE (owner, 2026-09-08). A loyalty cost is the shield with the signed number in it,
 *  and the number is real text so a screen reader gets it. Scryfall's symbol set has no loyalty
 *  badge (`+1.svg` and `-1.svg` both 404, checked 2026-09-08), so this is the site's own drawing. */
test("a signed number renders the shield with an accessible name; the number is real text", () => {
  render(<LoyaltyCost cost="−7" />);
  expect(screen.getByRole("img", { name: "minus 7 loyalty" })).toBeInTheDocument();
  expect(screen.getByText("−7")).toBeInTheDocument();
});

test("plus and zero read as loyalty too, and a hyphen is normalised to a minus sign", () => {
  const { rerender } = render(<LoyaltyCost cost="+1" />);
  expect(screen.getByRole("img", { name: "plus 1 loyalty" })).toBeInTheDocument();
  rerender(<LoyaltyCost cost="0" />);
  expect(screen.getByRole("img", { name: "0 loyalty" })).toBeInTheDocument();
  rerender(<LoyaltyCost cost="-3" />);
  expect(screen.getByText("−3")).toBeInTheDocument();
});

test("anything else is not a loyalty cost and renders as the plain cost", () => {
  expect(isLoyaltyCost("{T}")).toBe(false);
  expect(isLoyaltyCost("{2}, {T}")).toBe(false);
  expect(isLoyaltyCost("−X")).toBe(false);
  expect(isLoyaltyCost("+1")).toBe(true);
  render(<LoyaltyCost cost="{T}" />);
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByText("{T}")).toBeInTheDocument();
});
