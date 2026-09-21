import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { TypeLinePicker } from "./TypeLinePicker.js";

const TYPES = ["artifact", "creature", "instant", "land"];
const SUBTYPES = ["basilisk", "beast", "cave", "equipment", "saga", "sliver", "slith", "wizard"];

/** ONE CONTROL, TWO PARAMS. The test everything else here rests on: a reader types a word, and
 *  which table it came from is the component's problem, not theirs. */
const at = (props: Partial<Parameters<typeof TypeLinePicker>[0]> = {}) =>
  render(
    <TypeLinePicker
      types={TYPES} subtypes={SUBTYPES} chosenTypes={[]} chosenSubtypes={[]}
      onChange={() => {}} {...props}
    />,
  );

/** PREFIX FIRST, THEN ANYWHERE, and this is the whole reason the picker is not a plain `includes`:
 *  "sli" matches basiLISk nowhere but does match `slith` and `sliver`, while a substring search
 *  over 487 words buries the one that was meant. */
test("what starts with the query comes before what merely contains it", async () => {
  // SORTED, LIKE THE ARTIFACT. `build-static` ships the tables sorted so the file is stable across
  // builds that changed nothing, and the picker keeps the vocabulary's order within each group --
  // so the order asserted here is the order a reader sees.
  at({ types: [], subtypes: ["basilisk", "mislit", "slith", "sliver"] });
  await userEvent.type(screen.getByRole("combobox"), "sli");
  const shown = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
  expect(shown).toEqual(["slith", "sliver", "mislit"]);
});

/** A TYPE OUTRANKS A SUBTYPE ON A TIE, because it is the coarser question and the shorter list:
 *  a reader who types "cre" and means the card type should not have to scroll past a Crewmate. */
test("a type comes before a subtype that matches as well", async () => {
  at({ types: ["creature"], subtypes: ["crewmate"] });
  await userEvent.type(screen.getByRole("combobox"), "cre");
  const shown = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
  expect(shown).toEqual(["creature", "crewmate"]);
});

test("an empty field offers nothing — 487 rows is not a menu", () => {
  at();
  expect(screen.queryByRole("listbox")).toBeNull();
});

/** THE RESOLUTION, BOTH WAYS. This is what the merge buys and the only place it can go wrong: a
 *  word written to the wrong param filters against the wrong table and answers nothing, silently. */
test("choosing a type writes a type, and clears the field for the next", async () => {
  const onChange = vi.fn();
  at({ onChange });
  const field = screen.getByRole("combobox");
  await userEvent.type(field, "inst");
  fireEvent.mouseDown(within(screen.getByRole("listbox")).getByRole("option", { name: "instant" }));
  expect(onChange).toHaveBeenCalledWith({ types: ["instant"], subtypes: [] });
  expect(field).toHaveValue("");
});

test("choosing a subtype writes a subtype", async () => {
  const onChange = vi.fn();
  at({ onChange });
  await userEvent.type(screen.getByRole("combobox"), "sliv");
  fireEvent.mouseDown(within(screen.getByRole("listbox")).getByRole("option", { name: "sliver" }));
  expect(onChange).toHaveBeenCalledWith({ types: [], subtypes: ["sliver"] });
});

/** AND IT KEEPS WHAT THE OTHER TABLE ALREADY HELD. "Mill instants which are blue and cost less
 *  than 3" is the owner's own example and it needs a type and a subtype alive at once. */
test("a second choice keeps the first, whichever table each came from", async () => {
  const onChange = vi.fn();
  at({ chosenTypes: ["instant"], onChange });
  await userEvent.type(screen.getByRole("combobox"), "sliv");
  fireEvent.mouseDown(within(screen.getByRole("listbox")).getByRole("option", { name: "sliver" }));
  expect(onChange).toHaveBeenCalledWith({ types: ["instant"], subtypes: ["sliver"] });
});

/** ALREADY-CHOSEN WORDS ARE NOT OFFERED AGAIN: every term ANDs, so picking Sliver twice asks for a
 *  card that is a Sliver and a Sliver, which is a row that can only ever waste a press. */
test("a word already chosen is not offered again, from either table", async () => {
  at({ chosenTypes: ["instant"], chosenSubtypes: ["sliver"] });
  await userEvent.type(screen.getByRole("combobox"), "s");
  const shown = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
  expect(shown).not.toContain("sliver");
  expect(shown).toContain("slith");

  await userEvent.clear(screen.getByRole("combobox"));
  await userEvent.type(screen.getByRole("combobox"), "inst");
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("a chosen word is a chip that removes itself from its own table", async () => {
  const onChange = vi.fn();
  at({ chosenTypes: ["instant"], chosenSubtypes: ["sliver", "wizard"], onChange });

  await userEvent.click(screen.getByRole("button", { name: "Remove sliver" }));
  expect(onChange).toHaveBeenCalledWith({ types: ["instant"], subtypes: ["wizard"] });

  await userEvent.click(screen.getByRole("button", { name: "Remove instant" }));
  expect(onChange).toHaveBeenLastCalledWith({ types: [], subtypes: ["sliver", "wizard"] });
});

/** THE COMBOBOX OWES A SCREEN READER ITS STATE. Without `aria-expanded` moving, a listbox opening
 *  under the field is a change nobody is told about. */
test("the field announces whether a list is open", async () => {
  at();
  const field = screen.getByRole("combobox");
  expect(field).toHaveAttribute("aria-expanded", "false");
  await userEvent.type(field, "sli");
  expect(field).toHaveAttribute("aria-expanded", "true");
});
