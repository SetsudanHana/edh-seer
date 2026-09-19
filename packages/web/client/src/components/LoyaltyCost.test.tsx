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
  // "−X" moved to the TRUE side on 2026-09-20 -- see the X test below; it is a printed loyalty
  // cost and rendering it as bare monospace beside a badged "+2" was the defect.
  expect(isLoyaltyCost("+1")).toBe(true);
  render(<LoyaltyCost cost="{T}" />);
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByText("{T}")).toBeInTheDocument();
});

// ONE BADGE, AND THE SIGN CARRIES THE MEANING (owner, 2026-09-20). Three silhouettes -- a shield
// pointing up for a plus, down for a minus, flat for zero -- is not what the printed card does,
// and it read as three different marks rather than one cost.
test("the badge is one shape whatever the sign", () => {
  const shape = (cost: string): string | null => {
    const { container, unmount } = render(<LoyaltyCost cost={cost} />);
    const d = container.querySelector("path")?.getAttribute("d") ?? null;
    unmount();
    return d;
  };
  const plus = shape("+1");
  expect(plus).not.toBeNull();
  expect(shape("−7")).toBe(plus);
  expect(shape("0")).toBe(plus);
});

// A LOYALTY COST CAN BE X (Chandra, Awakened Inferno prints "−X"). Digits-only left the two costs
// on one card rendering two different ways -- a badge for "+2", bare monospace for "−X" -- which
// read as the page half-failing rather than as one card (seen on the deployed card page,
// 2026-09-20).
test("X is a loyalty cost too, and reads as X", () => {
  expect(isLoyaltyCost("−X")).toBe(true);
  expect(isLoyaltyCost("+X")).toBe(true);
  render(<LoyaltyCost cost="−X" />);
  expect(screen.getByRole("img", { name: "minus X loyalty" })).toBeInTheDocument();
  expect(screen.getByText("−X")).toBeInTheDocument();
});

test("still not a loyalty cost: mana, a tap, a compound cost", () => {
  expect(isLoyaltyCost("{T}")).toBe(false);
  expect(isLoyaltyCost("{2}, {T}")).toBe(false);
  expect(isLoyaltyCost("XX")).toBe(false);
  expect(isLoyaltyCost("")).toBe(false);
});
