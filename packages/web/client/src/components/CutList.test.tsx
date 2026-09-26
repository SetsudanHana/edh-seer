import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { CutChoice } from "../lib/cut-choice.js";
import { CutList } from "./CutList.js";

const cut = (name: string, extra: Partial<CutChoice> = {}): CutChoice =>
  ({ name, manaValue: 2, keeps: [], unmet: [], reasons: ["only 1 card connects to it"], twins: [], ...extra });

test("a cut says why it is here and what argues it stays", () => {
  render(<CutList cuts={[cut("Sidekick", { keeps: ["its best edge is on your main theme"], unmet: ["its condition needs a Cleric, and nothing in the deck provides that"] })]} slack={[]} />);
  const row = screen.getByRole("heading", { name: /Sidekick/ }).closest("li")!;
  expect(within(row).getByText("Only 1 card connects to it.")).toBeInTheDocument();
  expect(within(row).getByText("Its condition needs a Cleric, and nothing in the deck provides that.")).toBeInTheDocument();
  expect(within(row).getByText(/Keeps it:/).parentElement).toHaveTextContent("its best edge is on your main theme");
  expect(within(row).queryByText(/doesn't fill a core role/)).toBeNull();
});

test("six cuts show first, and the rest six at a time", async () => {
  render(<CutList cuts={Array.from({ length: 8 }, (_, i) => cut(`Card ${i + 1}`))} slack={[]} />);
  expect(screen.getAllByRole("heading", { name: /^Card \d/ })).toHaveLength(6);
  await userEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
  expect(screen.getAllByRole("heading", { name: /^Card \d/ })).toHaveLength(8);
});
