import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { KeywordRow } from "./KeywordRow.js";

/** THE ROW IS A NEW SURFACE, not an annotation on the printed lines (owner, 2026-09-20). Keywords
 *  already reach the page inside the card's own clauses, and a printed line is prose that keeps its
 *  words -- so the glyphs get their own row and `EngineReading` is untouched. */

test("a keyword with a glyph and one without both print their word", () => {
  const { container } = render(<KeywordRow keywords={["flying", "equip"]} />);
  // Measured 2026-09-20: mana draws `flying` and does NOT draw `equip`, which is the more common
  // of the two in this corpus (605 cards vs 671). The word carries it either way.
  expect(screen.getByText("flying")).toBeInTheDocument();
  expect(screen.getByText("equip")).toBeInTheDocument();
  const marks = [...container.querySelectorAll("i.ms")].map((i) => i.className);
  expect(marks).toHaveLength(1);
  expect(marks[0]).toContain("ms-ability-flying");
});

/** THE FIELD IS NEW, SO THE FIRST ARTIFACT TO SHIP WITHOUT IT IS THE NORMAL CASE. `keywords` was
 *  added to `CardPageRecord` in the same PR as this row; every static build made before it has the
 *  field on no card at all. Rendering nothing is correct, and a row that assumed an array would be
 *  a crash on every card page instead. */
test("no keywords, or a record built before the field existed, renders nothing", () => {
  expect(render(<KeywordRow keywords={[]} />).container.innerHTML).toBe("");
  expect(render(<KeywordRow keywords={undefined} />).container.innerHTML).toBe("");
});

test("the row is a labelled list, so it is one thing to a screen reader", () => {
  render(<KeywordRow keywords={["flying", "trample"]} />);
  const list = screen.getByRole("list", { name: "Keywords" });
  expect(list.querySelectorAll("li")).toHaveLength(2);
  // The glyph is redundant beside its own word, so it is never announced separately.
  expect(screen.queryByRole("img")).toBeNull();
});

// Scryfall's list carries ability WORDS beside keyword abilities. Both are things the card
// announces about itself, so both get a chip; neither invents a glyph.
test("an ability word rides along and asks for no glyph", () => {
  const { container } = render(<KeywordRow keywords={["probing telepathy"]} />);
  expect(screen.getByText("probing telepathy")).toBeInTheDocument();
  expect(container.querySelector("i.ms")).toBeNull();
});
