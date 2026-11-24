import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { expect, test, vi } from "vitest";
import { CardSearch } from "./CardSearch.js";
import type { EventFrequencyFile, NameIndexEntry } from "../lib/partners.js";
import type { Catalogue } from "../lib/search/catalogue.js";
import type { SearchLoader } from "../lib/search/load.js";
import type { Column } from "../lib/search/walk.js";

/** #1787: several sort keys, and the commander fields. A tiny index whose ties are the point. */
const VOCAB = { types: ["creature", "land"], subtypes: ["elf"], keywords: [] };
const row = (slug: string, name: string, extra: Partial<NameIndexEntry>): NameIndexEntry => ({ slug, name, identity: [], commander: false, t: [0], s: [], ...extra });
//   mv2: Alpha pow3, Delta pow3, Bravo pow1   mv3: Charlie pow3, Echo (no power)
const INDEX: NameIndexEntry[] = [
  row("alpha", "Alpha", { mv: 2, pow: 3, commander: true }),
  row("bravo", "Bravo", { mv: 2, pow: 1, commander: true }),
  row("charlie", "Charlie", { mv: 3, pow: 3 }),
  row("delta", "Delta", { mv: 2, pow: 3, commander: true }),
  row("echo", "Echo", { mv: 3 }),
];
const NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
const CATALOGUE: Catalogue = {
  formatVersion: 1, version: "v", deriveVersion: 1,
  groups: {
    types: { file: null, fields: [{ id: "t", kind: "set", values: VOCAB.types.map((v) => ({ v, n: 1 })) }] },
    commander: { file: "commander.json", fields: [
      { id: "is", kind: "set", label: "Is a commander", values: [{ v: "commander", n: 3 }] },
      { id: "partner", kind: "set", label: "Pairs as a second commander", values: [{ v: "partner", n: 2 }, { v: "partner-with", n: 1 }, { v: "friends-forever", n: 1 }] },
    ] },
  },
  namedLists: {},
};
// partner: Alpha and Charlie print Partner, Bravo prints Partner with, Delta prints Friends forever
const COLUMNS: Column[] = [
  { kind: "set", path: "is", group: "commander", values: new Map([["commander", [0, 1, 3]]]) },
  { kind: "set", path: "partner", group: "commander", values: new Map([["partner", [0, 2]], ["partner-with", [1]], ["friends-forever", [3]]]) },
];
const loader = (): SearchLoader => ({
  catalogue: vi.fn(async () => CATALOGUE),
  columnsFor: vi.fn(async (fields: readonly string[]) => COLUMNS.filter((c) => fields.includes(c.path))),
  abilityRows: vi.fn(async () => null),
});
const FREQ = { supply: {}, consume: {}, byIdentity: {} } as unknown as EventFrequencyFile;

const atUrl = (url: string, path: "/cards" | "/commanders" = "/cards") => {
  function Spy() { const loc = useLocation(); (Spy as unknown as { search: string }).search = loc.search; return null; }
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={<><CardSearch mode={path === "/cards" ? "cards" : "commanders"}
          load={async () => INDEX} vocabulary={async () => VOCAB} searchLoader={loader()}
          frequency={async () => FREQ} members={async () => null} /><Spy /></>} />
      </Routes>
    </MemoryRouter>,
  );
  return Spy as unknown as { search: string };
};
const names = () => {
  const links = within(screen.getByRole("list", { name: "Results" })).getAllByRole("link").map((a) => a.textContent ?? "");
  return NAMES.filter((n) => links.some((t) => t.includes(n))).sort((a, b) => links.findIndex((t) => t.includes(a)) - links.findIndex((t) => t.includes(b)));
};
const ASKED = "type=creature";

test("sort=mv:asc,pow:desc orders by mana value, then power, and a full tie falls to the name; a missing power is last", async () => {
  atUrl(`/cards?${ASKED}&sort=mv:asc,pow:desc`);
  await screen.findByRole("list", { name: "Results" });
  expect(names()).toStrictEqual(["Alpha", "Delta", "Bravo", "Charlie", "Echo"]);
});

test("the same two keys turned round: mv:desc,pow:asc", async () => {
  atUrl(`/cards?${ASKED}&sort=mv:desc,pow:asc`);
  await screen.findByRole("list", { name: "Results" });
  // mv3: Echo has no power (last in either direction, so after Charlie), mv2: Bravo(1) before Alpha/Delta(3, name order)
  expect(names()).toStrictEqual(["Charlie", "Echo", "Bravo", "Alpha", "Delta"]);
});

test("an OLD link, sort=mv&dir=desc, orders as one key with the name as its tie-break, and the page shows one order row filled", async () => {
  atUrl(`/cards?${ASKED}&sort=mv&dir=desc`);
  await screen.findByRole("list", { name: "Results" });
  expect(names()).toStrictEqual(["Charlie", "Echo", "Alpha", "Bravo", "Delta"]);
  expect(screen.getByLabelText("Order")).toHaveValue("mv");
  expect(screen.getByLabelText("Direction")).toHaveValue("desc");
  // the empty "Then by" row is offered, and it asks nothing
  expect(screen.getByLabelText("Then by, key 2")).toHaveValue("");
  expect(screen.queryByRole("status", { name: /Problems with the order/ })).toBeNull();
});

test("an unknown sort key shows a line naming it, the known keys still apply, and a link with only unknown keys keeps the default order", async () => {
  atUrl(`/cards?${ASKED}&sort=bogus:desc,mv:desc`);
  await screen.findByRole("list", { name: "Results" });
  expect(screen.getByRole("status", { name: /Problems with the order/ })).toHaveTextContent('There is no order called "bogus".');
  expect(names()).toStrictEqual(["Charlie", "Echo", "Alpha", "Bravo", "Delta"]);
  cleanup();
  atUrl(`/cards?${ASKED}&sort=sideways`);
  await screen.findByRole("list", { name: "Results" });
  expect(screen.getByRole("status", { name: /Problems with the order/ })).toHaveTextContent('"sideways"');
});

test("the builder adds a second key: it joins the link as sort=a:dir,b:dir, and its own direction turns only it", async () => {
  const spy = atUrl(`/cards?${ASKED}&sort=mv`);
  await screen.findByRole("list", { name: "Results" });
  await userEvent.selectOptions(screen.getByLabelText("Then by, key 2"), "pow");
  await waitFor(() => expect(spy.search).toContain("sort=mv%3Aasc%2Cpow%3Adesc"));
  expect(spy.search).not.toContain("dir=");
  expect(names()).toStrictEqual(["Alpha", "Delta", "Bravo", "Charlie", "Echo"]);
  await userEvent.selectOptions(screen.getByLabelText("Direction of key 2"), "asc");
  await waitFor(() => expect(spy.search).toContain("sort=mv%3Aasc%2Cpow%3Aasc"));
  expect(names()).toStrictEqual(["Bravo", "Alpha", "Delta", "Charlie", "Echo"]);
  // changing the FIRST key resets only its direction; the second key keeps its own
  await userEvent.selectOptions(screen.getByLabelText("Direction"), "desc");
  await waitFor(() => expect(spy.search).toContain("sort=mv%3Adesc%2Cpow%3Aasc"));
  await userEvent.selectOptions(screen.getByLabelText("Order"), "name");
  await waitFor(() => expect(spy.search).toContain("sort=name%3Aasc%2Cpow%3Aasc"));
  // a key already used is not offered again, and "None" drops the second key
  expect(within(screen.getByLabelText("Then by, key 2")).queryByRole("option", { name: "Name" })).toBeNull();
  await userEvent.selectOptions(screen.getByLabelText("Then by, key 2"), "");
  await waitFor(() => expect(spy.search).toContain("sort=name"));
  expect(spy.search).not.toContain("pow");
});

test("typed mode keeps the order beside x=, and changing the first key resets its direction but not the second key", async () => {
  const spy = atUrl(`/cards?x=${encodeURIComponent("t:creature")}&sort=mv:desc,pow:asc`);
  await screen.findByRole("list", { name: "Results" });
  expect(names()).toStrictEqual(["Charlie", "Echo", "Bravo", "Alpha", "Delta"]);
  await userEvent.selectOptions(screen.getByLabelText("Order"), "name");
  await waitFor(() => expect(spy.search).toContain("sort=name%3Aasc%2Cpow%3Aasc"));
  expect(spy.search).toContain("x=");
  expect(screen.getByLabelText("Direction")).toHaveValue("asc");
  // a second key can be added in typed mode too
  cleanup();
  const spy2 = atUrl(`/cards?x=${encodeURIComponent("t:creature")}&sort=mv`);
  await screen.findByRole("list", { name: "Results" });
  await userEvent.selectOptions(screen.getByLabelText("Then by, key 2"), "name");
  await waitFor(() => expect(spy2.search).toContain("sort=mv%3Aasc%2Cname%3Aasc"));
  expect(names()).toStrictEqual(["Alpha", "Bravo", "Delta", "Charlie", "Echo"]);
});

test("an unknown sort key is said in typed mode too", async () => {
  atUrl(`/cards?x=${encodeURIComponent("t:creature")}&sort=mv,nonsense`);
  await screen.findByRole("list", { name: "Results" });
  expect(screen.getByRole("status", { name: /Problems with the order/ })).toHaveTextContent('"nonsense"');
});

test("is:commander on /cards is exactly the list /commanders shows", async () => {
  atUrl(`/cards?x=${encodeURIComponent("is:commander")}`);
  await screen.findByRole("list", { name: "Results" });
  const onCards = names().sort();
  expect(onCards).toStrictEqual(["Alpha", "Bravo", "Delta"]);
  // the /commanders population is the rows the index flags
  expect(INDEX.filter((e) => e.commander).map((e) => e.name).sort()).toStrictEqual(onCards);
});

test("is:commander with a partner filter, typed: Partner with, Friends forever and a plain Partner each answer, and NOT leaves the rest", async () => {
  for (const [text, want] of [
    ["is:commander partner:partner", ["Alpha"]],
    ["is:commander partner:partner-with", ["Bravo"]],
    ["is:commander partner:friends-forever", ["Delta"]],
    ["partner:partner", ["Alpha", "Charlie"]],
    ["is:commander -partner:partner", ["Bravo", "Delta"]],
  ] as const) {
    atUrl(`/cards?x=${encodeURIComponent(text)}`);
    await screen.findByRole("list", { name: "Results" });
    expect(names().sort(), text).toStrictEqual([...want]);
    cleanup();
  }
});

test("an unknown partner kind is said and draws no list", async () => {
  atUrl(`/cards?x=${encodeURIComponent("partner:nonsense")}`);
  expect(await screen.findByRole("alert")).toHaveTextContent(/nonsense/);
  expect(screen.queryByRole("list", { name: "Results" })).toBeNull();
});

test("the builder: a link with f=is:commander&f=partner:friends-forever opens both rows in player words and answers Delta", async () => {
  atUrl("/cards?f=is:commander&f=partner:friends-forever");
  await waitFor(() => expect(names()).toStrictEqual(["Delta"]));
  expect(screen.getByRole("combobox", { name: "Is a commander" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Pairs as a second commander" })).toBeInTheDocument();
});

test("the builder: the menu offers the commander fields, and picking a kind writes f=", async () => {
  const spy = atUrl("/cards");
  await userEvent.click(await screen.findByText("Add a filter"));
  await userEvent.click(await screen.findByRole("button", { name: "Pairs as a second commander" }));
  await userEvent.click(screen.getByRole("combobox", { name: "Pairs as a second commander" }));
  await userEvent.click(await screen.findByRole("option", { name: /^partner-with/ }));
  await waitFor(() => expect(spy.search).toContain("f=partner%3Apartner-with"));
  await waitFor(() => expect(names()).toStrictEqual(["Bravo"]));
});
