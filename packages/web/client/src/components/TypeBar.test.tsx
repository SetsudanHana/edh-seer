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

/** I5 (whole-branch review, 2026-09-01). Design §4 calls direct in-place labels the REQUIRED
 *  secondary encoding: the two blues in this palette sit below the normal-vision separation floor
 *  and are protected only by never being adjacent, which a legend swatch undoes. On this fixture of
 *  66 nonlands, creature 21 / enchantment 19 / instant 12 / artifact 9 all clear the 8% floor and
 *  sorcery 5 (7.6%) does not — so the test also pins that the floor is a real boundary and not a
 *  label on everything. */
test("a segment wide enough to hold its count prints it in place", () => {
  render(<TypeBar slices={SLICES} />);
  expect(screen.getByTestId("type-segment-creature")).toHaveTextContent("21");
  expect(screen.getByTestId("type-segment-artifact")).toHaveTextContent("9");
  // Under the width floor: the digits would spill onto the neighbouring fill, so the legend is the
  // only label this one gets.
  expect(screen.getByTestId("type-segment-sorcery")).toHaveTextContent("");
  expect(screen.getByTestId("type-legend-sorcery")).toHaveTextContent("5");
});

/** The legend is not trimmed to the unlabelled segments: an in-place label is a bare NUMBER, so a
 *  wide segment stripped of its legend row would be identified by colour alone. */
test("every type keeps its legend row even when its count is printed in place", () => {
  render(<TypeBar slices={SLICES} />);
  expect(screen.getByTestId("type-legend-creature")).toHaveTextContent("creature");
  expect(screen.getByTestId("type-legend-creature")).toHaveTextContent("21");
});

/** The in-place label sits on the segment's OWN fill, so its contrast is a per-hue question and
 *  `segmentInk` answers it per hue. This pins the consequence at the component: whatever ink is
 *  chosen, it is one of the two `segmentInk` can return, never an inherited body colour that
 *  happens to be readable on a dark page and invisible on #b08e1d. */
test("an in-place label takes an ink measured against its own fill", () => {
  render(<TypeBar slices={SLICES} />);
  const label = screen.getByTestId("type-segment-enchantment").firstElementChild as HTMLElement;
  expect(label.style.color).toBe("rgb(0, 0, 0)"); // #1c8db7 reads 3.8:1 under white, 5.5:1 under black
  const onCreature = screen.getByTestId("type-segment-creature").firstElementChild as HTMLElement;
  expect(onCreature.style.color).toBe("rgb(255, 255, 255)"); // #277310 is the other way round
});

test("an empty deck renders nothing rather than an empty track", () => {
  const { container } = render(<TypeBar slices={[]} />);
  expect(container.firstChild).toBeNull();
});
