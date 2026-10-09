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

/** WHAT KILLS (#1034): a row said what the loop repeats and never what turns it into a win. */
test("a combo row names what wins through it, or says nothing here does", () => {
  const { unmount } = render(<ul><ComboLoop cards={["A", "B"]} result="Infinite ETB" manaValue={4} cheap wins={["Impact Tremors"]} /></ul>);
  expect(screen.getByTestId("bracket-combo")).toHaveTextContent("Wins through Impact Tremors");
  unmount();
  render(<ul><ComboLoop cards={["A", "B"]} result="Infinite ETB" manaValue={4} cheap wins={[]} /></ul>);
  expect(screen.getByTestId("bracket-combo")).toHaveTextContent("No card here turns it into a win");
});

test("a combo row whose result is the kill says it wins by itself, not that nothing wins", () => {
  render(<ul><ComboLoop cards={["A", "B"]} result="Infinite mana, Infinite damage" manaValue={4} cheap wins={[]} /></ul>);
  expect(screen.getByTestId("bracket-combo")).toHaveTextContent("Wins by itself: Infinite damage");
  expect(screen.getByTestId("bracket-combo")).not.toHaveTextContent("No card here");
});
