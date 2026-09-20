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

// THREE SHAPES, BECAUSE THE CARD PRINTS THREE. This test replaces a "the badge is one shape
// whatever the sign" test that shipped in PR #409 and was WRONG: the claim that a planeswalker
// prints one badge and the sign carries the meaning was asserted without checking. mana ships four
// separate loyalty glyphs -- `loyalty-up`, `loyalty-down`, `loyalty-zero`, `loyalty-start` -- with
// genuinely different paths, because the card draws them separately.
test("plus, minus and zero each get their own badge", () => {
  const shape = (cost: string): string | undefined => {
    const { container, unmount } = render(<LoyaltyCost cost={cost} />);
    const cls = [...(container.querySelector("i.ms")?.classList ?? [])].find((c) => c.startsWith("ms-loyalty-"));
    unmount();
    return cls;
  };
  expect(shape("+1")).toBe("ms-loyalty-up");
  expect(shape("\u22127")).toBe("ms-loyalty-down");
  expect(shape("0")).toBe("ms-loyalty-zero");
});

// THE NUMBER IS REAL TEXT, not mana's `:after` CSS content in MPlantin. That is the property the
// hand-drawn SVG had, the reason the badge is assembled here rather than taken wholesale, and the
// reason we ship one font instead of two.
test("the number is a real text node and the glyph is hidden from the tree", () => {
  const { container } = render(<LoyaltyCost cost="+1" />);
  expect(screen.getByText("+1")).toBeInTheDocument();
  expect(container.querySelector("i.ms")!.getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByRole("img", { name: "plus 1 loyalty" })).toBeInTheDocument();
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
