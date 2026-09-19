import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { EventPicker } from "./EventPicker.js";

/** THE EVENT PICKER (roadmap AJ3). What these assert is what a reader and a screen reader both
 *  depend on: the rows read in the engine's own sentences, the count beside each is the caller's
 *  (so it can be identity-scoped), choosing is reversible, and the ARIA combobox contract holds. */
const OPTIONS = ["mill|-|-|-", "dies|creature|-|-", "enters|land|-|-"];
const COUNTS: Record<string, number> = { "mill|-|-|-": 602, "dies|creature|-|-": 2525, "enters|land|-|-": 406 };
const counts = (k: string): number => COUNTS[k] ?? 0;

const mount = (chosen: string[] = [], onChange = vi.fn()) => {
  const r = render(<EventPicker label="Causes" hint="what a card can cause" options={OPTIONS} chosen={chosen} counts={counts} onChange={onChange} />);
  return { onChange, ...r };
};
const field = () => screen.getByRole("combobox", { name: /causes/i });

test("it lists the events by their engine sentence, most common first", async () => {
  mount();
  await userEvent.click(field());
  const rows = screen.getAllByRole("option").map((o) => o.textContent ?? "");
  expect(rows).toHaveLength(3);
  expect(rows[0]).toContain("2,525");
  expect(rows[2]).toContain("406");
  // The sentence, not the key: a reader never sees `dies|creature|-|-`.
  expect(rows[0]).not.toContain("|");
});

test("the count printed is the caller's, so it can be scoped to the reader's colours", async () => {
  render(<EventPicker label="Causes" hint="" options={["mill|-|-|-"]} chosen={[]} counts={() => 7} onChange={vi.fn()} />);
  await userEvent.click(field());
  expect(screen.getByRole("option").textContent).toContain("7");
});

test("choosing a row adds the key", async () => {
  const { onChange } = mount();
  await userEvent.click(field());
  await userEvent.click(screen.getAllByRole("option")[0]!);
  expect(onChange).toHaveBeenCalledWith(["dies|creature|-|-"]);
});

test("a chosen event is a chip that removes it again", async () => {
  const { onChange } = mount(["mill|-|-|-"]);
  await userEvent.click(screen.getByRole("button", { name: /^remove/i }));
  expect(onChange).toHaveBeenCalledWith([]);
});

test("a chosen event is announced as selected", async () => {
  mount(["mill|-|-|-"]);
  await userEvent.click(field());
  const selected = screen.getAllByRole("option").filter((o) => o.getAttribute("aria-selected") === "true");
  expect(selected).toHaveLength(1);
  expect(selected[0]!.textContent).toContain("602");
});

test("the search box narrows by the sentence, not by the key", async () => {
  mount();
  await userEvent.type(field(), "land");
  const rows = screen.getAllByRole("option");
  expect(rows).toHaveLength(1);
  expect(rows[0]!.textContent).toContain("406");
});

test("a search that matches nothing says so instead of rendering an empty list", async () => {
  mount();
  await userEvent.type(field(), "zzzz");
  expect(screen.queryAllByRole("option")).toHaveLength(0);
  expect(screen.getByText(/no event matches/i)).toBeInTheDocument();
});

/** THE ARIA CONTRACT, through the shared hook: the field owns `aria-activedescendant`, arrows move
 *  and Enter takes the active row. */
test("the keyboard reaches and takes a row", async () => {
  const { onChange } = mount();
  const box = field();
  fireEvent.focus(box);
  fireEvent.keyDown(box, { key: "ArrowDown" });
  fireEvent.keyDown(box, { key: "ArrowDown" });
  expect(box.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1]!.id);
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onChange).toHaveBeenCalledWith(["mill|-|-|-"]);
});

test("Escape closes the list", async () => {
  mount();
  const box = field();
  fireEvent.focus(box);
  expect(screen.getAllByRole("option")).toHaveLength(3);
  fireEvent.keyDown(box, { key: "Escape" });
  expect(screen.queryAllByRole("option")).toHaveLength(0);
});

/** 1,187 KEYS IS NOT A LIST TO RENDER. The cap withholds rows and says how many, the way the
 *  result list's own cap does. */
test("a long list is capped, and the line says what is withheld", async () => {
  const many = Array.from({ length: 60 }, (_, i) => `enters|creature|type${i}|-`);
  render(<EventPicker label="Causes" hint="" options={many} chosen={[]} counts={() => 1} onChange={vi.fn()} />);
  await userEvent.click(field());
  expect(screen.getAllByRole("option")).toHaveLength(50);
  expect(screen.getByText(/10 more/)).toBeInTheDocument();
});
