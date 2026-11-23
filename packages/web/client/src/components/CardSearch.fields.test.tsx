import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { expect, test, vi } from "vitest";
import { CardSearch } from "./CardSearch.js";
import type { NameIndexEntry } from "../lib/partners.js";
import type { Catalogue } from "../lib/search/catalogue.js";
import type { SearchLoader } from "../lib/search/load.js";
import type { Column } from "../lib/search/walk.js";

/** #1782 task 3: rows for catalogue fields no bespoke row covers. Nothing in CardSearch names these fields: the
 *  fixture catalogue is the only place they exist, which is what the elasticity tests prove. */
const VOCAB = { types: ["creature", "land"], subtypes: ["elf", "human"], keywords: ["flying"] };
const row = (slug: string, name: string, t: number[], s: number[]): NameIndexEntry => ({ slug, name, identity: [], commander: false, t, s });
// A is a creature elf, B a creature human, C a land, D and E plain creatures.
const INDEX = [row("a", "Card A", [0], [0]), row("b", "Card B", [0], [1]), row("c", "Card C", [1], []), row("d", "Card D", [0], []), row("e", "Card E", [0], [])];

const VERB = "tags.abilities.emits.verb";
const FLOOR = "tags.abilities.count.floor";
const set = (path: string, values: Record<string, number[]>): Column => ({ kind: "set", path, group: "", values: new Map(Object.entries(values)) });
const COLUMNS: Column[] = [
  set(VERB, { draw: [0, 1], mill: [1, 2], "gain-life": [3] }),
  { kind: "number", path: FLOOR, group: "", rows: [0, 1, 2, 3], min: [1, 2, 3, 0], max: [1, 2, 3, 0] },
  set("read", { grammar: [0, 1, 2], model: [3], unread: [4] }),
];
const CAT: Catalogue = {
  formatVersion: 1, version: "v", deriveVersion: 1, namedLists: {},
  groups: {
    types: { file: null, fields: [{ id: "t", kind: "set" }, { id: "st", kind: "set" }] },
    read: { file: "read.json", fields: [{
      id: "read", kind: "set", label: "Our reading",
      valueLabels: { grammar: "read by our rules", model: "read by the model", unread: "not read yet", "no-record": "no record" },
      values: [{ v: "grammar", n: 3 }, { v: "model", n: 1 }, { v: "unread", n: 1 }],
    }] },
    extra: { file: "extra.json", fields: [
      { id: VERB, kind: "set", label: "Emitted verb", values: [{ v: "draw", n: 2 }, { v: "mill", n: 2 }, { v: "gain-life", n: 1 }] },
      { id: FLOOR, kind: "number", label: FLOOR, min: 0, max: 3 },
    ] },
  },
};
const loaderOf = (cat: Catalogue | null = CAT, gate?: Promise<void>): SearchLoader => ({
  catalogue: vi.fn(async () => { await gate; return cat; }),
  columnsFor: vi.fn(async (fields: readonly string[]) => COLUMNS.filter((c) => fields.includes(c.path))),
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
const names = () => within(screen.getByRole("list", { name: "Results" })).getAllByRole("link").map((a) => (a.textContent ?? "").replace(/^(.+)\1$/, "$1"));
const openMenu = async () => userEvent.click(await screen.findByText("Add a filter"));
const q = (s: string) => decodeURIComponent(s);

test("elasticity: a NEW labelled set field and a NEW unlabelled number field appear in the menu with no code change", async () => {
  atUrl("/cards", loaderOf());
  await openMenu();
  expect(await screen.findByRole("button", { name: "Emitted verb" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Our reading" })).toBeInTheDocument();
  // The bespoke rows are not offered twice, and the unlabelled one waits for the switch.
  expect(screen.queryByRole("button", { name: FLOOR })).toBeNull();
  expect(screen.queryByRole("button", { name: "t" })).toBeNull();
  await userEvent.click(screen.getByRole("checkbox", { name: "Advanced fields" }));
  expect(await screen.findByRole("button", { name: FLOOR })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("checkbox", { name: "Advanced fields" }));
  expect(screen.queryByRole("button", { name: FLOOR })).toBeNull();
});

test("elasticity: the new set field filters, writes f=, and reads back from the link", async () => {
  const loader = loaderOf();
  const spy = atUrl("/cards", loader);
  await openMenu();
  await userEvent.click(await screen.findByRole("button", { name: "Emitted verb" }));
  // A row with no value asks nothing and fetches no group file.
  expect(loader.columnsFor).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("combobox", { name: "Emitted verb" }));
  await userEvent.click(await screen.findByRole("option", { name: /^draw/ }));
  await waitFor(() => expect(q(spy.search)).toContain(`f=${VERB}:draw`));
  await waitFor(() => expect(names()).toEqual(["Card A", "Card B"]));
  expect(loader.columnsFor).toHaveBeenCalledWith([VERB]);
});

test("elasticity: the new number field (under Advanced) filters by a range, writes frange=, and reads back", async () => {
  const spy = atUrl("/cards", loaderOf());
  await openMenu();
  await userEvent.click(await screen.findByRole("checkbox", { name: "Advanced fields" }));
  await userEvent.click(await screen.findByRole("button", { name: FLOOR }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: `${FLOOR}, from` }), "2");
  await waitFor(() => expect(q(spy.search)).toContain(`frange=${FLOOR}:2..`));
  await waitFor(() => expect(names()).toEqual(["Card B", "Card C"]));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: `${FLOOR}, to` }), "2");
  await waitFor(() => expect(names()).toEqual(["Card B"]));
});

test("a link carrying the new rows opens them filled, with no menu interaction", async () => {
  atUrl(`/cards?f=${VERB}:draw&frange=${FLOOR}:..1`, loaderOf());
  await waitFor(() => expect(names()).toEqual(["Card A"]));
  expect(screen.getByRole("combobox", { name: "Emitted verb" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: `${FLOOR}, to` })).toHaveValue("1");
  expect(screen.getByRole("button", { name: "Remove draw" })).toBeInTheDocument();
});

test("any of, within one row: (mill or gain-life) and draw is one card, in the link and in the chips", async () => {
  const spy = atUrl(`/cards?f=${VERB}:draw&fany=${VERB}:mill&fany=${VERB}:gain-life`, loaderOf());
  await waitFor(() => expect(names()).toEqual(["Card B"]));
  expect(screen.getByRole("button", { name: "Remove any of mill" })).toBeInTheDocument();
  // Moving a must chip to any-of rewrites one param and the answer follows: (draw or mill or gain-life).
  await userEvent.click(screen.getByRole("button", { name: `${VERB}: must. Change mode`.replace(VERB, "draw") }));
  await userEvent.click(screen.getByRole("button", { name: "Set draw to any of" }));
  await waitFor(() => expect(q(spy.search)).not.toContain(`&f=`));
  await waitFor(() => expect(names()).toEqual(["Card A", "Card B", "Card C", "Card D"]));
  await userEvent.click(screen.getByRole("button", { name: "draw: any of. Change mode" }));
  await userEvent.click(screen.getByRole("button", { name: "Set draw to never" }));
  await waitFor(() => expect(q(spy.search)).toContain(`fnot=${VERB}:draw`));
  await waitFor(() => expect(names()).toEqual(["Card C", "Card D"]));
});

test("any of on the type row: the chip has an any-of control and writes ortype", async () => {
  const spy = atUrl("/cards?type=creature", loaderOf());
  await userEvent.click(await screen.findByRole("button", { name: "creature: must. Change mode" }));
  await userEvent.click(await screen.findByRole("button", { name: "Set creature to any of" }));
  await waitFor(() => expect(spy.search).toContain("ortype=creature"));
  expect(spy.search).not.toMatch(/[?&]type=/);
  expect(await screen.findByRole("button", { name: "Remove any of creature" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "creature: any of. Change mode" }));
  await userEvent.click(screen.getByRole("button", { name: "Set creature to must" }));
  await waitFor(() => expect(spy.search).toMatch(/[?&]type=creature/));
  expect(spy.search).not.toContain("ortype");
});

test("an unknown field in the link says so in one line, and shows neither a list nor an empty answer", async () => {
  atUrl("/cards?f=nope.field:x", loaderOf());
  expect(await screen.findByText("This build doesn't know nope.field.")).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Results" })).toBeNull();
  expect(screen.queryByText(/No card matches/)).toBeNull();
});

test("an unknown value of a known field says so too, by the field's label", async () => {
  atUrl("/cards?f=read:bogus", loaderOf());
  expect(await screen.findByText(`This build doesn't know the value "bogus" for Our reading.`)).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Results" })).toBeNull();
});

test("a value on a number field, or a range on a set field, says what the field is", async () => {
  atUrl(`/cards?f=${FLOOR}:2&frange=read:1..2`, loaderOf());
  expect(await screen.findByText(`This build reads ${FLOOR} as a number, so the value "2" does not apply.`)).toBeInTheDocument();
  expect(screen.getByText("This build reads Our reading as a list of values, so a range does not apply.")).toBeInTheDocument();
});

test("the read row speaks in player words and filters on the fixture", async () => {
  const spy = atUrl("/cards", loaderOf());
  await openMenu();
  await userEvent.click(await screen.findByRole("button", { name: "Our reading" }));
  await userEvent.click(screen.getByRole("combobox", { name: "Our reading" }));
  const opts = within(await screen.findByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
  // A labelled value with no cards is still offered, with its count of zero.
  expect(opts).toEqual(["read by our rules (3)", "read by the model (1)", "not read yet (1)", "no record (0)"]);
  await userEvent.click(screen.getByRole("option", { name: /^not read yet/ }));
  await waitFor(() => expect(spy.search).toContain("f=read%3Aunread"));
  await waitFor(() => expect(names()).toEqual(["Card E"]));
  expect(screen.getByRole("button", { name: "Remove not read yet" })).toBeInTheDocument();
});

test("a build with no search pointer says so, like the type counts", async () => {
  atUrl(`/cards?f=read:unread`, loaderOf(null));
  expect(await screen.findByText("This build can't answer one of those filters yet.")).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Results" })).toBeNull();
});

test("a failed read offers the retry, and loading shows the loading line, never an empty list", async () => {
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  atUrl(`/cards?f=read:unread`, loaderOf(CAT, gate));
  expect(await screen.findByText("reading what cards do")).toBeInTheDocument();
  expect(screen.queryByText(/No card matches/)).toBeNull();
  open();
  await waitFor(() => expect(names()).toEqual(["Card E"]));
});

test("a failed catalogue read says so with a retry", async () => {
  const bad: SearchLoader = { catalogue: vi.fn(async () => { throw new Error("down"); }), columnsFor: vi.fn(async () => []) };
  atUrl(`/cards?f=read:unread`, bad);
  expect(await screen.findByText("Couldn't load filter data. Try again.")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThan(0);
});

test("opening the menu reads the catalogue, and no group file", async () => {
  const loader = loaderOf();
  atUrl("/cards", loader);
  await openMenu();
  await screen.findByRole("button", { name: "Emitted verb" });
  expect(loader.catalogue).toHaveBeenCalled();
  expect(loader.columnsFor).not.toHaveBeenCalled();
});

test("a page that never opens the menu and asks nothing generic never reads the catalogue", async () => {
  const loader = loaderOf();
  atUrl("/cards?type=creature", loader);
  await screen.findByRole("link", { name: /Card A/ });
  expect(loader.catalogue).not.toHaveBeenCalled();
});

test("removing a generic row clears its params", async () => {
  const spy = atUrl(`/cards?f=${VERB}:draw&type=creature`, loaderOf());
  await userEvent.click(await screen.findByRole("button", { name: "Remove the Emitted verb filter" }));
  await waitFor(() => expect(spy.search).not.toContain("f="));
  expect(spy.search).toContain("type=creature");
});

test("the type line is one any-of group across types and subtypes: (land or elf) is two cards, not one", async () => {
  atUrl("/cards?ortype=land&orsubtype=elf", loaderOf());
  await waitFor(() => expect(names()).toEqual(["Card A", "Card C"]));
});

test("an any-of word outside the vocabulary is said, with no list, even beside a known one", async () => {
  atUrl("/cards?orsubtype=elf&orsubtype=bogus", loaderOf());
  expect(await screen.findByText(`This build doesn't know the subtype "bogus".`)).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Results" })).toBeNull();
  expect(screen.queryByText(/No card matches/)).toBeNull();
});

test.each([["ortype", "type"], ["orkeyword", "keyword"]])("%s with an unknown word names a %s", async (param, kind) => {
  atUrl(`/cards?${param}=bogus`, loaderOf());
  expect(await screen.findByText(`This build doesn't know the ${kind} "bogus".`)).toBeInTheDocument();
});

test("a labelled value with no cards is known: fnot answers every card, f answers none", async () => {
  atUrl("/cards?fnot=read:no-record", loaderOf());
  await waitFor(() => expect(names()).toHaveLength(5));
  expect(screen.queryByText(/doesn't know/)).toBeNull();
});

test("a labelled value with no cards asked as a must says no card matches, not 'unknown'", async () => {
  atUrl("/cards?f=read:no-record", loaderOf());
  expect(await screen.findByText(/No card matches/)).toBeInTheDocument();
  expect(screen.queryByText(/doesn't know/)).toBeNull();
});

test("a malformed range on an unknown field still says it does not know the field", async () => {
  atUrl("/cards?frange=nope.field:abc..", loaderOf());
  expect(await screen.findByText("This build doesn't know nope.field.")).toBeInTheDocument();
});

test("a malformed range on a known field asks nothing, and does not narrow the list", async () => {
  atUrl(`/cards?frange=${FLOOR}:abc..`, loaderOf());
  await waitFor(() => expect(names()).toHaveLength(5));
});

test("the menu is not drawn empty: no kinds left and nothing from the catalogue means no menu", async () => {
  const ALL = "colors=W&cardcolors=W&type=creature&cardtypesmin=1&keyword=flying&mvmax=3&powmin=1&toumin=1";
  atUrl(`/cards?${ALL}`, loaderOf(null));
  await screen.findByText(/can't answer/);
  expect(screen.queryByText("Add a filter")).toBeNull();
});

test("with no kinds left the menu still appears once the catalogue offers fields", async () => {
  atUrl("/cards?colors=W&cardcolors=W&type=creature&cardtypesmin=1&keyword=flying&mvmax=3&powmin=1&toumin=1", loaderOf());
  await userEvent.click(await screen.findByText("Add a filter"));
  expect(await screen.findByRole("button", { name: "Emitted verb" })).toBeInTheDocument();
});

test("a chip is one unit of three parts: mode, word, remove, with names that hold their visible words", async () => {
  atUrl("/cards?type=creature&nottype=land&ortype=instant", loaderOf());
  const mode = await screen.findByRole("button", { name: "creature: must. Change mode" });
  expect(mode).toHaveTextContent("must");
  expect(screen.getByRole("button", { name: "land: never. Change mode" })).toHaveTextContent("never");
  expect(screen.getByRole("button", { name: "instant: any of. Change mode" })).toHaveTextContent("any of");
  expect(screen.getByRole("button", { name: "Remove creature" })).toBeInTheDocument();
  // The word of a never chip is struck through AND the word "never" is there.
  expect(screen.getByText("land").className).toMatch(/line-through/);
});

test("the mode menu opens on the mode button, offers the three modes, and Escape closes it back to the button", async () => {
  atUrl("/cards?type=creature", loaderOf());
  const mode = await screen.findByRole("button", { name: "creature: must. Change mode" });
  expect(mode).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(mode);
  expect(mode).toHaveAttribute("aria-expanded", "true");
  for (const m of ["must", "any of", "never"]) expect(screen.getByRole("button", { name: `Set creature to ${m}` })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Set creature to must" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("button", { name: "Set creature to never" })).toBeNull();
  expect(mode).toHaveFocus();
});

test("after choosing a mode, focus returns to that word's mode button", async () => {
  atUrl("/cards?type=creature", loaderOf());
  await userEvent.click(await screen.findByRole("button", { name: "creature: must. Change mode" }));
  await userEvent.click(screen.getByRole("button", { name: "Set creature to never" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "creature: never. Change mode" })).toHaveFocus());
});

test("a keyword and a generic value use the same chip", async () => {
  atUrl(`/cards?keyword=flying&f=${VERB}:draw`, loaderOf());
  expect(await screen.findByRole("button", { name: "flying: must. Change mode" })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "draw: must. Change mode" })).toBeInTheDocument();
});
