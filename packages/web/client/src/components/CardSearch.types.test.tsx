import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { expect, test, vi } from "vitest";
import { CardSearch } from "./CardSearch.js";
import type { NameIndexEntry } from "../lib/partners.js";
import type { Catalogue } from "../lib/search/catalogue.js";
import type { SearchLoader } from "../lib/search/load.js";

/** #1782: NOT on the type rows, the five type counts, and the changeling note. Every row carries `t`, as a
 *  real non-thin row does. */
const VOCAB = { types: ["creature", "land"], subtypes: ["borg", "elf", "human", "wizard", "forest"], keywords: [] };
const row = (slug: string, name: string, identity: string[], s: number[], extra: Partial<NameIndexEntry> = {}): NameIndexEntry =>
  ({ slug, name, identity, commander: false, t: [0], s, ...extra });
const INDEX: NameIndexEntry[] = [
  row("seven", "Seven of Nine", ["W", "U"], [0, 1, 2]),          // a Borg with three creature types
  row("mirror", "Mirror Changeling", ["G"], [0, 1, 2, 3]),        // every creature type
  row("trio", "Elf Trio", ["W"], [1, 2, 3]),                       // three, no Borg
  row("pair", "Elf Pair", ["U"], [1, 2]),                          // two
  row("far", "Far Away Trio", ["R"], [1, 2, 3]),                   // outside WUG
];
const CATALOGUE: Catalogue = {
  formatVersion: 1, version: "v", deriveVersion: 1, groups: {},
  namedLists: {
    card: { label: "Card types", values: ["creature", "land"] },
    super: { label: "Supertypes", values: ["legendary"] },
    creature: { label: "Creature types", values: ["borg", "elf", "human", "wizard"] },
  },
};
const loaderOf = (cat: Catalogue | null, gate?: Promise<void>): SearchLoader => ({
  catalogue: vi.fn(async () => { await gate; return cat; }),
  columnsFor: vi.fn(async () => []),
});

const atUrl = (url: string, searchLoader: SearchLoader) => {
  const path = url.split("?")[0]!;
  function Spy() { const loc = useLocation(); (Spy as unknown as { search: string }).search = loc.search; return null; }
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={<><CardSearch load={async () => INDEX} vocabulary={async () => VOCAB} searchLoader={searchLoader} /><Spy /></>} />
      </Routes>
    </MemoryRouter>,
  );
  return Spy as unknown as { search: string };
};
const names = () => within(screen.getByRole("list", { name: "Results" })).getAllByRole("link").map((a) => a.textContent ?? "");
const ACCEPT = "/cards?type=creature&notsubtype=borg&creaturetypesmin=3&colors=WUG&sort=creaturetypes";

test("acceptance: the 3-type non-Borg is the only answer, and one changeling is hidden, singular", async () => {
  atUrl(ACCEPT, loaderOf(CATALOGUE));
  await screen.findByRole("link", { name: /Elf Trio/ });
  expect(names()).toHaveLength(1);
  expect(screen.getByText("1 changeling hidden: a changeling is every creature type, so it is also a Borg.")).toBeInTheDocument();
});

test("Show them keeps changelings: the changeling leads and says every creature type, never a number", async () => {
  const spy = atUrl(ACCEPT, loaderOf(CATALOGUE));
  await userEvent.click(await screen.findByRole("button", { name: "Show them" }));
  await waitFor(() => expect(spy.search).toContain("changelings=keep"));
  await waitFor(() => expect(names()).toHaveLength(2));
  expect(names()[0]).toMatch(/Mirror Changeling/);
  expect(screen.getByText("every creature type")).toBeInTheDocument();
  expect(screen.queryByText(/hidden/)).toBeNull();
  expect(document.body.textContent).not.toMatch(/\b4 creature types\b/);
});

test("with changelings kept the page says so and offers to hide them again", async () => {
  const spy = atUrl(`${ACCEPT}&changelings=keep`, loaderOf(CATALOGUE));
  await userEvent.click(await screen.findByRole("button", { name: "Hide them" }));
  await waitFor(() => expect(spy.search).not.toContain("changelings"));
});

test("the button is a real, reachable control of at least 24px", async () => {
  atUrl(ACCEPT, loaderOf(CATALOGUE));
  const b = await screen.findByRole("button", { name: "Show them" });
  b.focus();
  expect(b).toHaveFocus();
  expect(b.className).toMatch(/\bchip\b/);
});

test("no empty-list flash while the catalogue is in flight: the loading line shows, then the answer", async () => {
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  atUrl(ACCEPT, loaderOf(CATALOGUE, gate));
  expect(await screen.findByText("reading what cards do")).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Results" })).toBeNull();
  expect(screen.queryByText(/No card matches/)).toBeNull();
  open();
  await screen.findByRole("link", { name: /Elf Trio/ });
});

test("a build with no search pointer says so in one line and shows no results", async () => {
  atUrl(ACCEPT, loaderOf(null));
  expect(await screen.findByText(/This build can't answer type counts yet/)).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Results" })).toBeNull();
  expect(screen.queryByText(/No card matches/)).toBeNull();
});

test("a late catalogue for a question the reader has since dropped is ignored", async () => {
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  atUrl("/cards?type=creature&creaturetypesmin=3", loaderOf(CATALOGUE, gate));
  await userEvent.click(await screen.findByRole("button", { name: "Remove the Number of types filter" }));
  expect(await screen.findByRole("link", { name: /Elf Pair/ })).toBeInTheDocument();
  open();
  await new Promise((r) => setTimeout(r, 20));
  expect(names()).toHaveLength(5);
  expect(screen.queryByText(/can't answer/)).toBeNull();
});

test("a NOT list answers from the rows without waiting for the catalogue, and a plain query never asks for one", async () => {
  const never = new Promise<void>(() => {});
  atUrl("/cards?type=creature&notsubtype=borg", loaderOf(CATALOGUE, never));
  await screen.findByRole("link", { name: /Elf Trio/ });
  expect(names()).toHaveLength(3); // the Borg and the changeling are out
});

test("a query with no NOT subtype and no count never reads the catalogue", async () => {
  const loader = loaderOf(CATALOGUE);
  atUrl("/cards?type=creature&mvmax=9", loader);
  await screen.findByRole("link", { name: /Elf Trio/ });
  expect(loader.catalogue).not.toHaveBeenCalled();
});

test("a chip's and/not control moves a word between must and never, in the URL", async () => {
  const spy = atUrl("/cards?type=creature", loaderOf(CATALOGUE));
  await userEvent.click(await screen.findByRole("button", { name: "Leave out creature" }));
  await waitFor(() => expect(spy.search).toContain("nottype=creature"));
  expect(spy.search).not.toMatch(/[?&]type=/);
  await userEvent.click(await screen.findByRole("button", { name: "Require creature" }));
  await waitFor(() => expect(spy.search).toMatch(/[?&]type=creature/));
  expect(spy.search).not.toContain("nottype");
});

test("the Number of types row sets one count from the menu", async () => {
  const spy = atUrl("/cards?type=creature", loaderOf(CATALOGUE));
  await userEvent.click(await screen.findByText("Add a filter"));
  await userEvent.click(await screen.findByRole("button", { name: "Number of types" }));
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Add a count" }), "creaturetypes");
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Creature types, from" }), "3");
  await waitFor(() => expect(spy.search).toContain("creaturetypesmin=3"));
});

test("the order offers the five counts", async () => {
  atUrl("/cards?type=creature", loaderOf(CATALOGUE));
  const order = await screen.findByLabelText("Order");
  for (const label of ["Card types, all faces", "Card types, front face", "Supertypes", "Subtypes", "Creature types"]) {
    expect(within(order).getByRole("option", { name: label })).toBeInTheDocument();
  }
});
