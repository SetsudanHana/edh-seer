import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { expect, test, vi } from "vitest";
import { CardSearch } from "./CardSearch.js";
import type { EventFrequencyFile, EventMembers, NameIndexEntry } from "../lib/partners.js";
import type { Catalogue } from "../lib/search/catalogue.js";
import type { SearchLoader } from "../lib/search/load.js";
import type { Column } from "../lib/search/walk.js";

/** #1783: the typed query box and `x=`. Same fixture as the 1b acceptance test (CardSearch.types.test.tsx), so the typed
 *  form of that query can be compared with the builder's answer. */
const VOCAB = { types: ["creature", "land", "kindred", "instant"], subtypes: ["borg", "elf", "human", "wizard", "forest"], keywords: ["flying"] };
const row = (slug: string, name: string, identity: string[], s: number[], extra: Partial<NameIndexEntry> = {}): NameIndexEntry =>
  ({ slug, name, identity, commander: false, t: [0], s, ...extra });
const INDEX: NameIndexEntry[] = [
  row("seven", "Seven of Nine", ["W", "U"], [0, 1, 2]),
  row("mirror", "Mirror Changeling", ["G"], [0, 1, 2, 3]),
  row("trio", "Elf Trio", ["W"], [1, 2, 3]),
  row("pair", "Elf Pair", ["U"], [1, 2]),
  row("far", "Far Away Trio", ["R"], [1, 2, 3]),
];
const CATALOGUE: Catalogue = {
  formatVersion: 1, version: "v", deriveVersion: 1,
  // A REAL CATALOGUE SHIPS THE TYPES GROUP, with the values of t and st: they must not rescue an empty vocabulary.
  groups: {
    types: { file: null, fields: [
      { id: "t", kind: "set", values: VOCAB.types.map((v) => ({ v, n: 1 })) },
      { id: "st", kind: "set", values: VOCAB.subtypes.map((v) => ({ v, n: 1 })) },
    ] },
    faces: { file: "faces.json", fields: [{ id: "stBest", kind: "set", fallback: "st", values: [{ v: "borg", n: 1 }] }] } },
  namedLists: {
    card: { label: "Card types", values: ["creature", "land"] },
    creature: { label: "Creature types", values: ["borg", "elf", "human", "wizard"] },
  },
};
const BEST: Column = { kind: "set", path: "stBest", group: "faces", fallback: "st", overrides: [], values: new Map() };
const loader = (): SearchLoader => ({
  catalogue: vi.fn(async () => CATALOGUE),
  columnsFor: vi.fn(async (fields: readonly string[]) => (fields.includes("stBest") ? [BEST] : [])),
  abilityRows: vi.fn(async () => null),
});
const FREQ: EventFrequencyFile = { supply: { "mill|-|-|-": 2 }, consume: { "dies|creature|-|-": 1 }, byIdentity: { "mill|-|-|-": [] } } as unknown as EventFrequencyFile;
const MEMBERS: Record<string, EventMembers> = {
  "mill|-|-|-": { p: [0, 2], c: [] } as unknown as EventMembers,
  "dies|creature|-|-": { p: [], c: [1, 3] } as unknown as EventMembers,
};

const atUrl = (url: string) => {
  function Spy() { const loc = useLocation(); (Spy as unknown as { search: string }).search = loc.search; return null; }
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/cards" element={<><CardSearch
          load={async () => INDEX} vocabulary={async () => VOCAB} searchLoader={loader()}
          frequency={async () => FREQ} members={async (_b, k) => MEMBERS[k] ?? null} /><Spy /></>} />
      </Routes>
    </MemoryRouter>,
  );
  return Spy as unknown as { search: string };
};
/** A tile's link reads its name twice (art alt and caption), so a name is matched, not compared whole. */
const NAMES = ["Seven of Nine", "Mirror Changeling", "Elf Trio", "Elf Pair", "Far Away Trio"];
const names = () => {
  const text = within(screen.getByRole("list", { name: "Results" })).getAllByRole("link").map((a) => a.textContent ?? "");
  return NAMES.filter((n) => text.some((t) => t.includes(n)));
};
const LEGACY = "/cards?type=creature&notsubtype=borg&creaturetypesmin=3&colors=WUG&sort=creaturetypes";
const box = () => screen.findByRole("textbox", { name: /type a query/i });

test("the 1b query typed gives the same list as the builder, and the builder's own text is that query", async () => {
  atUrl(LEGACY);
  await screen.findByRole("link", { name: /Elf Trio/ });
  const builderList = names();
    // THE BOX SHOWS WHAT THE ROWS ASK, in the canonical text.
  const text = ((await box()) as HTMLInputElement).value;
  expect(text).toBe("id<=WUG t:creature -st:borg #t>=1 #stBest@creature>=3");
  cleanup();

  const spy = atUrl(`/cards?x=${encodeURIComponent(text)}&sort=creaturetypes`);
  await screen.findByRole("link", { name: /Elf Trio/ });
  expect(names()).toStrictEqual(builderList);
  expect(builderList).toStrictEqual(["Elf Trio"]);
  expect(spy.search).not.toContain("type=");
});

test("an old link carries no x and is not given one by being shown", async () => {
  const spy = atUrl(LEGACY);
  await screen.findByRole("link", { name: /Elf Trio/ });
  await new Promise((r) => setTimeout(r, 400));
  expect(spy.search).not.toContain("x=");
  expect(spy.search).toContain("notsubtype=borg");
});

test("typing valid text asks the question: the list changes and the link carries x", async () => {
  const spy = atUrl("/cards");
  await userEvent.type(await box(), "-st:elf or st:borg");
  await waitFor(() => expect(spy.search).toContain("x="));
  await screen.findByRole("list", { name: "Results" });
  // every row holds elf, so "not elf" is none and the Borgs (Seven, and the changeling) are the answer: an or-group the rows cannot hold
  expect(names()).toStrictEqual(["Seven of Nine", "Mirror Changeling"]);
  expect(screen.getByText(/The typed query is the question/)).toBeInTheDocument();
});

test("an event word reads the event's members", async () => {
  atUrl(`/cards?x=${encodeURIComponent("makes:mill|-|-| -st:borg")}`);
  // `-` is not part of the key here, so this one is an unknown event: said, no list
  expect(await screen.findByRole("alert")).toHaveTextContent("unknown event");
  cleanup();
  atUrl(`/cards?x=${encodeURIComponent("makes:mill|-|-|- or asks:dies|creature|-|-")}`);
  await screen.findByRole("list", { name: "Results" });
  expect(names()).toStrictEqual(["Seven of Nine", "Mirror Changeling", "Elf Trio", "Elf Pair"]);
});

test("invalid text shows the problem with its position and draws no list", async () => {
  atUrl("/cards?x=" + encodeURIComponent("t:creature foo:x"));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("unknown field `foo` at 11");
  expect(screen.queryByRole("list", { name: "Results" })).toBeNull();
  expect(screen.queryByText(/No card matches/)).toBeNull();
  expect(await box()).toHaveAttribute("aria-invalid", "true");
});

test("an unknown value is an error, not a dropped term", async () => {
  atUrl("/cards?x=" + encodeURIComponent("st:bogus"));
  expect(await screen.findByRole("alert")).toHaveTextContent("unknown value `bogus` for st at 3");
  expect(screen.queryByRole("list", { name: "Results" })).toBeNull();
});

test("typing text that breaks shows the error under the box, and fixing it brings the list back", async () => {
  atUrl("/cards");
  const b = await box();
  await userEvent.type(b, "st:bogus");
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  await userEvent.clear(b);
  await userEvent.type(b, "st:elf");
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  await screen.findByRole("list", { name: "Results" });
});

test("Back to the filters drops x and the paused rows come back", async () => {
  const spy = atUrl(`/cards?type=creature&x=${encodeURIComponent("st:elf")}`);
  await userEvent.click(await screen.findByRole("button", { name: "Back to the filters" }));
  await waitFor(() => expect(spy.search).not.toContain("x="));
  expect(spy.search).toContain("type=creature");
  expect(await screen.findByRole("button", { name: "Remove the Type line filter" })).toBeInTheDocument();
});

test("typed -st:borg hides changelings with the builder's note and count, and Show them keeps working beside x", async () => {
  const spy = atUrl(`/cards?x=${encodeURIComponent("t:creature -st:borg")}`);
  await screen.findByRole("link", { name: /Elf Trio/ });
  expect(names()).toStrictEqual(["Elf Trio", "Elf Pair", "Far Away Trio"]);
  // the note needs the catalogue's creature list, which arrives after the rows do
  expect(await screen.findByText("1 changeling hidden: a changeling has every creature type, Borg included.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Show them" }));
  await waitFor(() => expect(spy.search).toContain("changelings=keep"));
  expect(spy.search).toContain("x=");
  await waitFor(() => expect(names()).toContain("Mirror Changeling"));
  expect(screen.queryByText(/changeling hidden/)).toBeNull();
  expect(screen.getByRole("button", { name: "Hide them" })).toBeInTheDocument();
});

test("an old artifact with no vocabulary cannot check a value: it says so and draws no list", async () => {
  function Spy() { return null; }
  render(
    <MemoryRouter initialEntries={[`/cards?x=${encodeURIComponent("t:creature st:elf")}`]}>
      <Routes><Route path="/cards" element={<><CardSearch load={async () => INDEX} vocabulary={async () => ({ types: [], subtypes: [], keywords: [] })} searchLoader={loader()} frequency={async () => FREQ} members={async () => null} /><Spy /></>} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Can't check value `creature` for t: this build has no type vocabulary at 2");
  expect(screen.queryByRole("list", { name: "Results" })).toBeNull();
  expect(screen.queryByText(/No card matches/)).toBeNull();
});

test("stBest is a sparse column: its values are the fallback's, so stBest:elf is known", async () => {
  atUrl(`/cards?x=${encodeURIComponent("stBest:elf")}`);
  await screen.findByRole("list", { name: "Results" });
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a changeling toggle follows polarity: --st:borg shows no note", async () => {
  atUrl(`/cards?x=${encodeURIComponent("t:creature --st:borg")}`);
  await screen.findByRole("list", { name: "Results" });
  await new Promise((r) => setTimeout(r, 100));
  expect(screen.queryByText(/changeling.* hidden/)).toBeNull();
});

test("-(st:borg or st:elf) hides changelings and says so", async () => {
  atUrl(`/cards?x=${encodeURIComponent("t:creature -(st:borg or st:wizard)")}`);
  expect(await screen.findByText(/changelings? hidden/)).toBeInTheDocument();
});

test("rows the text cannot say (amount) are named, not silently left out of the box", async () => {
  atUrl("/cards?produce=" + encodeURIComponent("mill|-|-|-") + "&amtmin=1");
  expect(await screen.findByText(/leaves out the .*amount/i)).toBeInTheDocument();
});

test("in typed mode, changing Order resets the direction to the new order's own", async () => {
  const spy = atUrl(`/cards?x=${encodeURIComponent("t:creature")}&sort=mv&dir=desc`);
  await screen.findByRole("list", { name: "Results" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Order" }), "name");
  await waitFor(() => expect(spy.search).toContain("sort=name"));
  expect(spy.search).not.toContain("dir=");
  expect(screen.getByRole("combobox", { name: "Direction" })).toHaveValue("asc");
});

test("a cannot-answer is not followed by 'fix the query'", async () => {
  render(
    <MemoryRouter initialEntries={[`/cards?x=${encodeURIComponent("t:creature")}`]}>
      <Routes><Route path="/cards" element={<CardSearch load={async () => INDEX} vocabulary={async () => ({ types: [], subtypes: [], keywords: [] })} searchLoader={loader()} frequency={async () => FREQ} members={async () => null} />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("alert");
  expect(screen.queryByText(/Fix the typed query/)).toBeNull();
});

test("the box's name carries its visible label, and the box turns ligatures off so <= is typed as it is read", async () => {
  atUrl("/cards");
  const b = await box();
  expect(b.className).toContain("font-variant-ligatures:none");
});
