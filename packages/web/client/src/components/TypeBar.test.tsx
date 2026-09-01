import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { TypeBar } from "./TypeBar.js";
import { TYPE_ORDER } from "../lib/deck-shape.js";

const SLICES = [
  { type: "creature", count: 21 },
  { type: "enchantment", count: 19 },
  { type: "instant", count: 12 },
  { type: "artifact", count: 9 },
  { type: "sorcery", count: 5 },
];

test("prints the nonland total, which is the whole the segments are parts of", () => {
  render(<TypeBar slices={SLICES} />);
  expect(screen.getByTestId("type-total")).toHaveTextContent("66");
});

test("every type is named in text with its count, never colour alone", () => {
  render(<TypeBar slices={SLICES} />);
  for (const s of SLICES) {
    expect(screen.getByTestId(`type-legend-${s.type}`)).toHaveTextContent(String(s.count));
    expect(screen.getByTestId(`type-legend-${s.type}`)).toHaveTextContent(s.type);
  }
});

/** THE SEGMENT ORDER IS THE COLOUR GUARANTEE. `enchantment` and `sorcery` are both blues below the
 *  normal-vision separation floor; the palette passes only because they are never adjacent. A
 *  change that sorts segments by size would put them together and break it with no visible error,
 *  so the order is asserted here rather than trusted. */
test("segments render in TYPE_ORDER, not sorted by size", () => {
  render(<TypeBar slices={SLICES} />);
  const rendered = [...document.querySelectorAll('[data-testid^="type-segment-"]')]
    .map((el) => el.getAttribute("data-testid")!.replace("type-segment-", ""));
  const expected = TYPE_ORDER.filter((t) => SLICES.some((s) => s.type === t));
  expect(rendered).toEqual(expected);
  // Guard against the test passing because both happen to be size-ordered.
  expect(rendered).not.toEqual([...SLICES].sort((a, b) => b.count - a.count).map((s) => s.type));
});

test("an empty deck renders nothing rather than an empty track", () => {
  const { container } = render(<TypeBar slices={[]} />);
  expect(container.firstChild).toBeNull();
});
