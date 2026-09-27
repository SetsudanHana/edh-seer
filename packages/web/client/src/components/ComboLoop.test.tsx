import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ComboLoop } from "./ComboLoop.js";

/** THE COMBO AS A LOOP (report cohesion audit, 2026-09-27): its pieces on one dashed ring, with
 *  their art where the deck has it, and beside it the names, the result and the cost. */
test("draws each piece on one dashed ring, with its art, and names the loop beside it", () => {
  const { container } = render(<ul><ComboLoop cards={["A", "B", "C"]} result="Infinite mana, Infinite tokens, Infinite damage, Infinite draw" manaValue={9} cheap={false}
    artOf={(n) => (n === "B" ? "/art/b.jpg" : undefined)} /></ul>);
  const ring = container.querySelector("circle[stroke-dasharray]");
  expect(ring).not.toBeNull();
  expect(container.querySelectorAll("image")).toHaveLength(1);
  expect(container.querySelector("image")).toHaveAttribute("href", "/art/b.jpg");
  const row = screen.getByTestId("bracket-combo");
  expect(row).toHaveTextContent("A + B + C");
  expect(row).toHaveTextContent("Infinite mana · Infinite tokens · Infinite damage +1 more");
  expect(row).toHaveTextContent("9 mana together");
  expect(row).not.toHaveTextContent(/rule out bracket 3/);
});
