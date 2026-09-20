import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { HeaderSearch } from "./HeaderSearch.js";
import type { NameIndexEntry } from "../lib/partners.js";

/** THE SEARCH FIELD IN THE HEADER (spec 2026-09-08 part 1). What these assert is the contract a
 *  reader and a screen reader both depend on: it lives in the static header, it costs nothing until
 *  focused, it is a combobox with the ARIA keyboard model, and picking a row goes to the card. */
const INDEX: NameIndexEntry[] = [
  { slug: "krenko-mob-boss", name: "Krenko, Mob Boss", identity: ["R"], commander: true },
  { slug: "krenko-tin-street-kingpin", name: "Krenko, Tin Street Kingpin", identity: ["R"], commander: true },
  { slug: "skullclamp", name: "Skullclamp", identity: [], commander: false },
];

function Where() { const { pathname } = useLocation(); return <p data-testid="where">{pathname}</p>; }

let header: HTMLElement;
beforeEach(() => {
  header = document.createElement("header");
  header.className = "site-header";
  document.body.appendChild(header);
});
afterEach(() => { header.remove(); });

const mount = (load = vi.fn(async () => INDEX)) => {
  render(
    <MemoryRouter initialEntries={["/cards/skullclamp"]}>
      <HeaderSearch load={load} />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
  return load;
};

const field = () => screen.getByRole("combobox", { name: "Find a card" });

test("it mounts into the static header and loads the index on first focus only", async () => {
  const load = mount();
  expect(header.contains(field())).toBe(true);
  expect(load).not.toHaveBeenCalled();
  fireEvent.focus(field());
  fireEvent.blur(field());
  fireEvent.focus(field());
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  expect(load).toHaveBeenCalledWith("/static");
});

test("typing lists the matches with identity and a commander mark", async () => {
  mount();
  fireEvent.focus(field());
  fireEvent.change(field(), { target: { value: "krenko" } });
  const options = await screen.findAllByRole("option");
  expect(options.map((o) => o.textContent)).toEqual([
    expect.stringContaining("Krenko, Mob Boss"),
    expect.stringContaining("Krenko, Tin Street Kingpin"),
  ]);
  // THE MARK IS A GLYPH, NOT THE WORD (owner, 2026-09-20: "if we have the top search, then I would
  // replace that"). An `<i>` has no `textContent`, so the row's accessible content is the name plus
  // this image's label -- asserted as the ACCESSIBLE NAME rather than as text, which is the only
  // form that fails if the label is dropped and the glyph left bare. The pips stay `aria-hidden`.
  expect(within(options[0]!).getByRole("img", { name: "Commander" })).toBeInTheDocument();
  expect(options[0]!.textContent).not.toContain("commander");
  expect(field()).toHaveAttribute("aria-expanded", "true");
});

/** A NON-COMMANDER ROW HAS NO MARK AT ALL, which is what makes the mark mean anything. Its own test
 *  because both Krenko rows in the fixture ARE commanders -- asserting the absence inside that
 *  result set proved nothing and passed for the wrong reason. */
test("a card that cannot lead a deck carries no commander mark", async () => {
  mount();
  fireEvent.focus(field());
  fireEvent.change(field(), { target: { value: "skullclamp" } });
  const options = await screen.findAllByRole("option");
  expect(options).toHaveLength(1);
  expect(options[0]!.textContent).toContain("Skullclamp");
  expect(within(options[0]!).queryByRole("img", { name: "Commander" })).toBeNull();
});

test("at most eight rows", async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    slug: `kard-${i}`, name: `Kard ${i}`, identity: [], commander: false,
  }));
  mount(vi.fn(async () => many));
  fireEvent.focus(field());
  fireEvent.change(field(), { target: { value: "kard" } });
  expect(await screen.findAllByRole("option")).toHaveLength(8);
});

test("arrow keys move the active option and Enter opens it", async () => {
  mount();
  fireEvent.focus(field());
  fireEvent.change(field(), { target: { value: "krenko" } });
  await screen.findAllByRole("option");
  fireEvent.keyDown(field(), { key: "ArrowDown" });
  fireEvent.keyDown(field(), { key: "ArrowDown" });
  expect(field()).toHaveAttribute("aria-activedescendant", "site-search-opt-1");
  fireEvent.keyDown(field(), { key: "Enter" });
  expect(screen.getByTestId("where").textContent).toBe("/cards/krenko-tin-street-kingpin");
  expect((field() as HTMLInputElement).value).toBe("");
  expect(screen.queryByRole("option")).toBeNull();
});

test("Enter with nothing active opens the first match, and Escape closes the list", async () => {
  mount();
  fireEvent.focus(field());
  fireEvent.change(field(), { target: { value: "clamp" } });
  await screen.findAllByRole("option");
  fireEvent.keyDown(field(), { key: "Escape" });
  expect(screen.queryByRole("option")).toBeNull();
  expect(field()).toHaveAttribute("aria-expanded", "false");
  // A different value: a controlled input fires no change for the same one.
  fireEvent.change(field(), { target: { value: "skull" } });
  await screen.findAllByRole("option");
  fireEvent.keyDown(field(), { key: "Enter" });
  expect(screen.getByTestId("where").textContent).toBe("/cards/skullclamp");
});

test("a click on a row opens it", async () => {
  mount();
  fireEvent.focus(field());
  fireEvent.change(field(), { target: { value: "krenko" } });
  const options = await screen.findAllByRole("option");
  fireEvent.click(options[1]!);
  expect(screen.getByTestId("where").textContent).toBe("/cards/krenko-tin-street-kingpin");
});

test("no match says so in a row that is not an option", async () => {
  mount();
  fireEvent.focus(field());
  fireEvent.change(field(), { target: { value: "zzzz" } });
  await screen.findByText("No card by that name");
  expect(screen.queryByRole("option")).toBeNull();
});

test("the phone toggle opens the field and moves focus into it", () => {
  mount();
  const toggle = screen.getByRole("button", { name: "Search" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  act(() => { fireEvent.click(toggle); });
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("search").hasAttribute("data-open")).toBe(true);
  return waitFor(() => expect(document.activeElement).toBe(field()));
});
