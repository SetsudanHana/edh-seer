import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { expect, test, vi } from "vitest";
import { CardSearch } from "./CardSearch.js";
import type { NameIndexEntry } from "../lib/partners.js";
import type { Catalogue } from "../lib/search/catalogue.js";
import { createSearchLoader, type SearchLoader } from "../lib/search/load.js";
import { encodePostings } from "../lib/search/postings.js";

/** #1782: NOT on the type rows, the five type counts, and the changeling note. Every row carries `t`, as a
 *  real non-thin row does. */
const VOCAB = { types: ["creature", "land", "kindred", "instant"], subtypes: ["borg", "elf", "human", "wizard", "forest"], keywords: [] };
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
  await userEvent.click(await screen.findByRole("button", { name: "creature: must. Change mode" }));
  await userEvent.click(await screen.findByRole("button", { name: "Set creature to never" }));
  await waitFor(() => expect(spy.search).toContain("nottype=creature"));
  expect(spy.search).not.toMatch(/[?&]type=/);
  await userEvent.click(await screen.findByRole("button", { name: "creature: never. Change mode" }));
  await userEvent.click(await screen.findByRole("button", { name: "Set creature to must" }));
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

// ---- review fixes -------------------------------------------------------------------------------------------------

/** A real loader over a scripted fetch, so a failure is a failure of the transport and not of a stub. */
function scripted(over: { noPointer?: boolean; failCatalogue?: () => boolean; failFaces?: () => boolean } = {}) {
  const catalogue = {
    ...CATALOGUE,
    groups: { faces: { file: "faces.json", fields: [{ id: "tFront", kind: "set" as const, fallback: "t" }] } },
  };
  const fetchImpl = vi.fn(async (u: string | URL | Request) => {
    const url = String(u);
    const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
    const no = { ok: false, json: async () => ({}) } as Response;
    if (url.endsWith("manifest.json")) return ok(over.noPointer ? { version: "v" } : { version: "v", search: "s-x" });
    if (url.endsWith("catalogue.json")) return over.failCatalogue?.() ? no : ok(catalogue);
    if (url.endsWith("faces.json")) return over.failFaces?.() ? no : ok({ fields: { tFront: { kind: "set", values: {}, fallback: "t", overrides: encodePostings([]) } } });
    return no;
  });
  return createSearchLoader("/static", fetchImpl as unknown as typeof fetch);
}

test("a failed faces fetch is said, never an empty list, and Try again recovers", async () => {
  let down = true;
  atUrl("/cards?type=creature&fronttypesmin=1", scripted({ failFaces: () => down }));
  expect(await screen.findByText("Couldn't load type data. Try again.")).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Results" })).toBeNull();
  expect(screen.queryByText(/No card matches/)).toBeNull();
  down = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("link", { name: /Elf Trio/ });
  expect(names()).toHaveLength(5);
});

test("a catalogue that fails once and then loads is retried by the chip", async () => {
  let calls = 0;
  atUrl("/cards?type=creature&creaturetypesmin=3", scripted({ failCatalogue: () => ++calls === 1 }));
  expect(await screen.findByText("Couldn't load type data. Try again.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("link", { name: /Elf Trio/ });
  expect(screen.queryByText(/Couldn't load/)).toBeNull();
});

test("no search pointer and a failed fetch say different things", async () => {
  atUrl("/cards?type=creature&creaturetypesmin=3", scripted({ noPointer: true }));
  expect(await screen.findByText("This build can't answer type counts yet.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});

test("keeping changelings with a NOT that is not a creature type does not wait for, or need, the catalogue", async () => {
  atUrl("/cards?type=creature&notsubtype=forest&changelings=keep", scripted({ noPointer: true }));
  await screen.findByRole("link", { name: /Elf Trio/ });
  expect(names()).toHaveLength(5);
  expect(screen.queryByText(/can't answer/)).toBeNull();
});

test("a kindred instant changeling sorted by subtypes says every creature type, never 377", async () => {
  const rows = [
    row("crib", "Crib Swap Like", ["W"], [0, 1, 2, 3], { t: [3, 2] }),
    row("plain", "Plain Elf", ["W"], [1, 2]),
  ];
  function Page() {
    return <CardSearch load={async () => rows} vocabulary={async () => VOCAB} searchLoader={loaderOf(CATALOGUE)} />;
  }
  render(<MemoryRouter initialEntries={["/cards?notsubtype=forest&changelings=keep&notsubtype=borg&sort=subtypes"]}><Routes><Route path="/cards" element={<Page />} /></Routes></MemoryRouter>);
  await screen.findByRole("link", { name: /Plain Elf/ });
  // the borg NOT is forgiven for the changeling, so it is listed, first, with its words and not a number
  expect(names()[0]).toMatch(/Crib Swap Like/);
  expect(screen.getByText("every creature type")).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/\b\d{3} /);
});

test("the note names every creature type that was NOT-ed, with the right articles", async () => {
  atUrl("/cards?type=creature&notsubtype=borg&notsubtype=elf", loaderOf(CATALOGUE));
  expect(await screen.findByText("1 changeling hidden: a changeling is every creature type, so it is also a Borg and an Elf.")).toBeInTheDocument();
});

test("three creature types read as a list", async () => {
  atUrl("/cards?type=creature&notsubtype=borg&notsubtype=elf&notsubtype=human", loaderOf(CATALOGUE));
  expect(await screen.findByText(/so it is also a Borg, an Elf and a Human\.$/)).toBeInTheDocument();
});

test("the never chip and the must chip have names of their own, each holding its visible word (WCAG 2.5.3)", async () => {
  atUrl("/cards?type=creature&nottype=land", loaderOf(CATALOGUE));
  expect(await screen.findByRole("button", { name: "Remove never land" })).toBeInTheDocument();
  // ONE CHIP, THREE PARTS: the mode word leads, the word follows, the cross removes. Never keeps its word.
  expect(screen.getByRole("button", { name: "land: never. Change mode" })).toHaveTextContent("never");
  expect(screen.getByRole("button", { name: "creature: must. Change mode" })).toHaveTextContent("must");
  expect(screen.getByRole("button", { name: "Remove creature" })).toBeInTheDocument();
});

// ---- keep + a creature NOT must never silently drop the changeling --------------------------------------------------
const KEEP_BORG = "/cards?type=creature&notsubtype=borg&changelings=keep";

test("keep + a creature NOT while the catalogue is pending: the loading line, never a list without the changeling", async () => {
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  atUrl(KEEP_BORG, loaderOf(CATALOGUE, gate));
  expect(await screen.findByText("reading what cards do")).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Results" })).toBeNull();
  open();
  await screen.findByRole("link", { name: /Mirror Changeling/ });
  expect(names().some((n) => /Mirror Changeling/.test(n))).toBe(true);
});

test("keep + a creature NOT with a failed catalogue: the retry line, not a list that lost the changeling", async () => {
  atUrl(KEEP_BORG, scripted({ failCatalogue: () => true }));
  expect(await screen.findByText("Couldn't load type data. Try again.")).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Results" })).toBeNull();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("keep + a creature NOT on a build with no pointer: the list, and a line saying changelings cannot be matched", async () => {
  atUrl(KEEP_BORG, scripted({ noPointer: true }));
  expect(await screen.findByText("Changelings can't be matched on this build.")).toBeInTheDocument();
  await screen.findByRole("link", { name: /Elf Trio/ });
  expect(names().some((n) => /Mirror Changeling/.test(n))).toBe(false);
});

test("keep + a non-creature NOT on a build with no pointer still lists everything (nothing was dropped)", async () => {
  atUrl("/cards?type=creature&notsubtype=forest&changelings=keep", scripted({ noPointer: true }));
  await screen.findByRole("link", { name: /Elf Trio/ });
  expect(names()).toHaveLength(5);
});
