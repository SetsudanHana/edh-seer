import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { EventPicker } from "./EventPicker.js";
import { eventKeyAction, eventKeyClause } from "../lib/demand-sentence.js";

/** THE EVENT PICKER (roadmap AJ3). What these assert is what a reader and a screen reader both
 *  depend on: the rows read in the engine's own sentences, the count beside each is the caller's
 *  (so it can be identity-scoped), choosing is reversible, and the ARIA combobox contract holds. */
const OPTIONS = ["mill|-|-|-", "dies|creature|-|-", "enters|land|-|-"];
const COUNTS: Record<string, number> = { "mill|-|-|-": 602, "dies|creature|-|-": 2525, "enters|land|-|-": 406 };
const counts = (k: string): number => COUNTS[k] ?? 0;
/** THE OTHER SIDE'S SIZE, which is what orders the list: how many cards are waiting for each. */
const ASKERS: Record<string, number> = { "mill|-|-|-": 30, "dies|creature|-|-": 418, "enters|land|-|-": 12 };
const demand = (k: string): number => ASKERS[k] ?? 0;
/** HOW THIS PICKER SAYS AN EVENT (roadmap AK4). The page hands the Causes picker the action and
 *  the Cares picker the clause; here the action stands in for both. */
const say = (k: string): string => eventKeyAction(k) ?? eventKeyClause(k);

const mount = (chosen: string[] = [], onChange = vi.fn()) => {
  const r = render(<EventPicker label="Causes" hint="what a card can cause" options={OPTIONS} chosen={chosen} counts={counts} demand={demand} say={say} onChange={onChange} />);
  return { onChange, ...r };
};
const field = () => screen.getByRole("combobox", { name: /causes/i });

/** THE ORDER IS THE OTHER SIDE'S SIZE. Ordering causes by how many cards CAUSE them put nine
 *  statics reaching the whole corpus at the top of this list and "a creature dies" below the fold
 *  (measured 2026-09-19); an event nearly every card can cause is the worst filter on the list. */
test("it lists the events by their engine sentence, most asked-for first", async () => {
  mount();
  await userEvent.click(field());
  const rows = screen.getAllByRole("option").map((o) => o.textContent ?? "");
  expect(rows).toHaveLength(3);
  // 418 cards wait for a creature to die; 30 for a mill; 12 for a land.
  expect(rows[0]).toContain("2,525");
  expect(rows[1]).toContain("602");
  expect(rows[2]).toContain("406");
  // The sentence, not the key: a reader never sees `dies|creature|-|-`.
  expect(rows[0]).not.toContain("|");
});

/** AND IT IS NOT THE PRINTED COUNT THAT ORDERS. A row that 24,982 cards can cause, which nothing
 *  asks for, belongs below one that 2,525 can cause and 418 are waiting for. */
test("a huge cause count does not buy the top of the list", async () => {
  const keys = ["applies:pump|creature,artifact,enchantment,land,planeswalker,battle|-|-", "dies|creature|-|-"];
  render(<EventPicker
    label="Causes" hint="" options={keys} chosen={[]}
    counts={(k) => (k.startsWith("applies:") ? 24982 : 2525)}
    demand={(k) => (k.startsWith("applies:") ? 3 : 418)}
    say={say} onChange={vi.fn()} />);
  await userEvent.click(field());
  const rows = screen.getAllByRole("option").map((o) => o.textContent ?? "");
  expect(rows[0]).toContain("2,525");
  expect(rows[1]).toContain("24,982");
});

test("the count printed is the caller's, so it can be scoped to the reader's colours", async () => {
  render(<EventPicker label="Causes" hint="" options={["mill|-|-|-"]} chosen={[]} counts={() => 7} demand={demand} say={say} onChange={vi.fn()} />);
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
  render(<EventPicker label="Causes" hint="" options={many} chosen={[]} counts={() => 1} demand={(k) => Number(k.split("type")[1])} say={say} onChange={vi.fn()} />);
  await userEvent.click(field());
  expect(screen.getAllByRole("option")).toHaveLength(50);
  expect(screen.getByText(/10 more/)).toBeInTheDocument();
});

/** THE LIST HAS TO GO AWAY (owner-reported 2026-09-19, on the deployed site): `open` was set on
 *  focus and cleared only by Escape, so both pickers' lists stayed open at once and pushed the
 *  results off the page. `HeaderSearch` has always closed on blur; this one never did. */
test("leaving the field closes the list", async () => {
  render(<>
    <EventPicker label="Causes" hint="" options={OPTIONS} chosen={[]} counts={counts} demand={demand} say={say} onChange={vi.fn()} />
    <button type="button">elsewhere</button>
  </>);
  await userEvent.click(field());
  expect(screen.getAllByRole("option")).toHaveLength(3);
  await userEvent.click(screen.getByRole("button", { name: "elsewhere" }));
  expect(screen.queryAllByRole("option")).toHaveLength(0);
});

/** BUT CHOOSING MUST NOT COUNT AS LEAVING. The option is not focusable, so a click on it blurs the
 *  field; if that closed the list the click would land on nothing and the row would never be
 *  chosen. It is also a MULTI-select: the list stays up so a second event can be picked. */
test("choosing a row keeps the list open, because more than one event can be chosen", async () => {
  const onChange = vi.fn();
  const { rerender } = mount([], onChange);
  await userEvent.click(field());
  await userEvent.click(screen.getAllByRole("option")[0]!);
  expect(onChange).toHaveBeenCalledWith(["dies|creature|-|-"]);
  rerender(<EventPicker label="Causes" hint="what a card can cause" options={OPTIONS} chosen={["dies|creature|-|-"]} counts={counts} demand={demand} say={say} onChange={onChange} />);
  expect(screen.getAllByRole("option")).toHaveLength(3);
});

test("removing a chip does not leave the list open behind it", async () => {
  render(<>
    <EventPicker label="Causes" hint="" options={OPTIONS} chosen={["mill|-|-|-"]} counts={counts} demand={demand} say={say} onChange={vi.fn()} />
    <button type="button">elsewhere</button>
  </>);
  await userEvent.click(screen.getByRole("button", { name: /^Remove/ }));
  await userEvent.click(screen.getByRole("button", { name: "elsewhere" }));
  expect(screen.queryAllByRole("option")).toHaveLength(0);
});

/** THE LIST IS A POPUP, NOT A BLOCK IN THE FLOW (owner, 2026-09-20: "when I scroll all the way to
 *  the bottom and start typing in the search bar my page is scrolling up").
 *
 *  In the flow, the open listbox IS document height -- 50 rows on focus, one row two keystrokes
 *  later -- so each narrowing shortened the page under a reader already at the bottom and the
 *  browser clamped scrollTop to the new height. Measured in the browser at 1920x1080 on `/cards`:
 *  opening the list at the bottom grew the document 1,337 -> 1,628px, typing a narrow query shrank
 *  it straight back and the page jumped up 290px. Out of flow the document stays 1,337px
 *  throughout and the jump is 0.
 *
 *  A CLASS ASSERTION, because jsdom resolves no Tailwind: what it pins is that the positioning is
 *  still declared, which is the thing a later refactor would drop without noticing. The pixel
 *  measurement is in the commit message and cannot run here. */
test("the open list is positioned out of the flow, so filtering never moves the page", async () => {
  mount([]);
  await userEvent.click(field());
  const list = screen.getByRole("listbox");
  expect(list.className).toMatch(/\babsolute\b/);
  // An absolute child needs a positioned ancestor, or it resolves against the page and lands
  // somewhere else entirely -- the `.sr-only` trap the UI rules name, in a different costume.
  const anchored = list.closest(".relative");
  expect(anchored).not.toBeNull();
  expect(anchored!.contains(field())).toBe(true);
});
