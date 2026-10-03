import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { MapKey } from "./MapKey.js";

/** ONE KEY FOR EVERY MAP (#993): a row is a colour, its name, and its count under it; a row that
 *  can open its group is a button, one that cannot is plain text. */
test("MapKey renders name and count per colour, and a button only where the row opens something", async () => {
  const pick = vi.fn();
  render(<MapKey rows={[
    { key: "a", name: "Creature ETBs", hue: "red", count: "17 with Inalla, 1 of them only once", onPick: pick },
    { key: "b", name: "Go wide", hue: "blue", count: "1 with Inalla" },
  ]} />);
  const list = screen.getByRole("list", { name: "What the colours are" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  expect(within(list).getByText("17 with Inalla, 1 of them only once")).toBeInTheDocument();
  expect(within(list).getAllByRole("button")).toHaveLength(1);
  await userEvent.click(within(list).getByRole("button", { name: /Creature ETBs/ }));
  expect(pick).toHaveBeenCalledOnce();
});

test("MapKey draws nothing with no rows", () => {
  const { container } = render(<MapKey rows={[]} />);
  expect(container).toBeEmptyDOMElement();
});
