import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { SubtypePicker } from "./SubtypePicker.js";

const ALL = ["basilisk", "beast", "cave", "equipment", "saga", "sliver", "slith", "wizard"];

/** PREFIX FIRST, THEN ANYWHERE, and this is the whole reason the picker is not a plain `includes`:
 *  "sli" matches basiLISk nowhere but does match `slith` and `sliver`, while a substring search
 *  over 488 subtypes buries the one that was meant. */
test("what starts with the query comes before what merely contains it", async () => {
  // SORTED, LIKE THE ARTIFACT. `build-static` ships the table sorted so the file is stable across
  // builds that changed nothing, and the picker keeps the vocabulary's order within each group --
  // so the order asserted here is the order a reader sees.
  render(<SubtypePicker all={["basilisk", "mislit", "slith", "sliver"]} chosen={[]} onChange={() => {}} />);
  await userEvent.type(screen.getByRole("combobox"), "sli");
  const shown = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
  expect(shown).toEqual(["slith", "sliver", "mislit"]);
});

test("an empty field offers nothing — 488 rows is not a menu", () => {
  render(<SubtypePicker all={ALL} chosen={[]} onChange={() => {}} />);
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("choosing one reports it and clears the field for the next", async () => {
  const onChange = vi.fn();
  render(<SubtypePicker all={ALL} chosen={[]} onChange={onChange} />);
  const field = screen.getByRole("combobox");
  await userEvent.type(field, "sliv");
  fireEvent.mouseDown(within(screen.getByRole("listbox")).getByRole("option", { name: "sliver" }));
  expect(onChange).toHaveBeenCalledWith(["sliver"]);
  expect(field).toHaveValue("");
});

/** ALREADY-CHOSEN SUBTYPES ARE NOT OFFERED AGAIN: every term ANDs, so picking Sliver twice asks
 *  for a card that is a Sliver and a Sliver, which is a row that can only ever waste a press. */
test("a subtype already chosen is not offered again", async () => {
  render(<SubtypePicker all={ALL} chosen={["sliver"]} onChange={() => {}} />);
  await userEvent.type(screen.getByRole("combobox"), "sli");
  const shown = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
  expect(shown).toEqual(["slith"]);
});

test("a chosen subtype is a chip that removes itself", async () => {
  const onChange = vi.fn();
  render(<SubtypePicker all={ALL} chosen={["sliver", "wizard"]} onChange={onChange} />);
  await userEvent.click(screen.getByRole("button", { name: "Remove sliver" }));
  expect(onChange).toHaveBeenCalledWith(["wizard"]);
});

/** THE COMBOBOX OWES A SCREEN READER ITS STATE. Without `aria-expanded` moving, a listbox opening
 *  under the field is a change nobody is told about. */
test("the field announces whether a list is open", async () => {
  render(<SubtypePicker all={ALL} chosen={[]} onChange={() => {}} />);
  const field = screen.getByRole("combobox");
  expect(field).toHaveAttribute("aria-expanded", "false");
  await userEvent.type(field, "sli");
  expect(field).toHaveAttribute("aria-expanded", "true");
});
