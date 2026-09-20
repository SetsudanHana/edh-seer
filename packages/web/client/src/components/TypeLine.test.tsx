import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { TypeLine } from "./TypeLine.js";

test("the line is printed unchanged, with its type's mark before it", () => {
  const { container } = render(<TypeLine line="Legendary Creature — Human Warrior Cleric" />);
  expect(screen.getByText("Legendary Creature — Human Warrior Cleric")).toBeInTheDocument();
  expect(container.querySelector("i.ms")!.className).toContain("ms-creature");
});

/** THE SUBTYPES ARE NOT TYPES. Scanning the whole line would let "Creature — Land Golem" or
 *  "Enchantment — Saga" match on a word after the em dash and draw the wrong mark. */
test("only the half before the em dash is read", () => {
  const { container } = render(<TypeLine line="Enchantment — Saga" />);
  expect(container.querySelector("i.ms")!.className).toContain("ms-enchantment");
});

/** A line mana draws no glyph for renders exactly as it always did -- there is no state where the
 *  reader loses the words. */
test("an unreadable type line falls back to the bare line", () => {
  const { container } = render(<TypeLine line="Dungeon" />);
  expect(screen.getByText("Dungeon")).toBeInTheDocument();
  expect(container.querySelector("i.ms")).toBeNull();
});

/** The mark is redundant beside the word "Creature" that follows it, so it is never announced. */
test("the mark is hidden from the accessibility tree", () => {
  const { container } = render(<TypeLine line="Artifact — Equipment" />);
  expect(container.querySelector("i.ms")!.getAttribute("aria-hidden")).toBe("true");
  expect(screen.queryByRole("img")).toBeNull();
});
