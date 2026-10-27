import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import type { RedundancyResult } from "@edh-seer/matcher/redundancy-static";
import { buildEngineModel } from "../lib/engine-model.js";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { CardDrawerProvider, useCardDrawer, type DrawerExtras } from "./card-drawer.js";
import { useCardMenu } from "./card-menu.js";

const sp = (n: number) => Array.from({ length: n }, (_, i) => `P${i}`);
const chip = (dim: "deck" | "shared" | "amplifier", label: string) => ({ dim, label });
const hit = (name: string, tier: "same" | "close" | "output" | "outcome", deckChips: ReturnType<typeof chip>[] = [], extra: object = {}) =>
  ({ id: 1, name, slug: name.toLowerCase().replace(/ /g, "-"), tier, chips: [], score: 1, inDeck: false, sharedPartners: [], deckChips, ...extra });
const result = (hits: object[], comparable?: boolean, seedN = 2): RedundancyResult => ({ hits, poolSize: 3, seedPartners: sp(seedN), amplifiers: [], stats: { buckets: [], bucketSizes: [], poolSize: 0, fetched: 0, fallbacks: [], missing: [], ...(comparable === undefined ? {} : { comparable }) } }) as unknown as RedundancyResult;

const HITS = [
  hit("Witty Roastmaster", "close", [chip("deck", "in your deck"), chip("shared", "reworded label")], { inDeck: true, sharedPartners: sp(2) }),
  hit("Warstorm Surge", "same", [chip("shared", "x")], { sharedPartners: sp(1) }),
  hit("Corpse Knight", "outcome", [chip("amplifier", "loses synergy with Fiery Emancipation")]),
];

function Host({ redundancy, open = "Reducer", token, companion, children }: { redundancy?: DrawerExtras["redundancy"]; open?: string; token?: string; companion?: string; children?: React.ReactNode }) {
  const deckBase = engineDeck();
  const { report } = deckBase;
  const graph = companion ? { ...deckBase.graph, nodes: deckBase.graph.nodes.map((n) => (n.id === companion ? { ...n, isCompanion: true } : n)) } : deckBase.graph;
  const model = buildEngineModel(report, graph);
  function Register() {
    const { setExtras, open: o, openToken } = useCardDrawer();
    useEffect(() => {
      setExtras({ model, ...(redundancy ? { redundancy } : {}) });
      if (token) openToken(token); else if (open) o(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setExtras, o, openToken]);
    return null;
  }
  return <MemoryRouter><CardDrawerProvider graph={graph}><Register />{children}</CardDrawerProvider></MemoryRouter>;
}
const drawer = () => screen.findByTestId("card-inspector");

test("the button asks, shows a full-strength 'Finding' state, then the tiers with their deck chips", async () => {
  let done!: (r: RedundancyResult) => void;
  const redundancy = vi.fn(() => new Promise<RedundancyResult>((r) => { done = r; }));
  render(<Host redundancy={redundancy} />);
  const d = await drawer();
  await userEvent.click(within(d).getByRole("button", { name: "Find redundancy in this deck" }));
  expect(redundancy).toHaveBeenCalledWith("Reducer");
  const busy = within(d).getByRole("button", { name: /Finding/ });
  expect(busy).not.toBeDisabled();
  await act(async () => { done(result(HITS)); });
  expect(await within(d).findByRole("heading", { name: /^Same effect/ })).toBeInTheDocument();
  expect(within(d).getByRole("heading", { name: /^Close variants/ })).toBeInTheDocument();
  expect(within(d).getByRole("heading", { name: /^Same payoff, different trigger/ })).toBeInTheDocument();
  expect(within(d).getByText("in your deck")).toBeInTheDocument();
  expect(within(d).getByText("works with 2 of 2 of the same deck cards")).toBeInTheDocument();
  const warn = within(d).getByText("loses synergy with Fiery Emancipation");
  expect(warn.className).toContain("text-(--warning)");
  expect(within(d).getByText("in your deck").className).toContain("text-(--muted)");
  expect(within(d).getByRole("heading", { level: 4, name: "Redundancy in this deck" }).className).toContain("t-subsection");
  expect(within(d).getByRole("heading", { name: "Close variants · 1" })).toBeInTheDocument();
  expect(within(d).getByRole("link", { name: "Warstorm Surge" })).toHaveAttribute("href", "/cards/warstorm-surge");
  expect(within(d).getByText(/do the same job as Reducer in this deck/)).toBeInTheDocument();
});

test("a deck card the index has no page for is a name, not a link", async () => {
  const { slug: _s, ...noSlug } = hit("Mystery Card", "same", [chip("deck", "in your deck")], { inDeck: true });
  render(<Host redundancy={async () => result([noSlug])} />);
  const d = await drawer();
  await userEvent.click(within(d).getByRole("button", { name: "Find redundancy in this deck" }));
  expect(await within(d).findByText("Mystery Card")).toBeInTheDocument();
  expect(within(d).queryByRole("link", { name: "Mystery Card" })).toBeNull();
});

test("a failed search says so and retries", async () => {
  const redundancy = vi.fn().mockRejectedValueOnce(new Error("shard 404")).mockResolvedValueOnce(result(HITS));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  render(<Host redundancy={redundancy} />);
  const d = await drawer();
  await userEvent.click(within(d).getByRole("button", { name: "Find redundancy in this deck" }));
  expect(await within(d).findByText(/couldn't load/i)).toBeInTheDocument();
  await userEvent.click(within(d).getByRole("button", { name: "Try again" }));
  expect(await within(d).findByRole("heading", { name: /^Same effect/ })).toBeInTheDocument();
  expect(redundancy).toHaveBeenCalledTimes(2);
});

test("no hits says no card in the colours does the job, with no empty heading", async () => {
  render(<Host redundancy={async () => result([])} />);
  const d = await drawer();
  await userEvent.click(within(d).getByRole("button", { name: "Find redundancy in this deck" }));
  expect(await within(d).findByText(/No card in your colors does the same job/)).toBeInTheDocument();
  expect(within(d).queryByRole("heading", { name: /^Same effect/ })).toBeNull();
});

test("a long tier shows 5, then 'Show N more'", async () => {
  const many = Array.from({ length: 11 }, (_, i) => hit(`Card ${i + 1}`, "close"));
  render(<Host redundancy={async () => result(many)} />);
  const d = await drawer();
  await userEvent.click(within(d).getByRole("button", { name: "Find redundancy in this deck" }));
  await within(d).findByRole("heading", { name: /^Close variants/ });
  expect(within(d).getAllByRole("listitem")).toHaveLength(5);
  await userEvent.click(within(d).getByRole("button", { name: "Show 6 more" }));
  expect(within(d).getAllByRole("listitem")).toHaveLength(11);
});

test("closing and reopening the same card does not search again", async () => {
  const redundancy = vi.fn(async () => result(HITS));
  function Reopen() {
    const { open, close } = useCardDrawer();
    return <><button onClick={close}>shut</button><button onClick={() => open("Reducer")}>again</button></>;
  }
  render(<Host redundancy={redundancy}><Reopen /></Host>);
  const d = await drawer();
  await userEvent.click(within(d).getByRole("button", { name: "Find redundancy in this deck" }));
  await within(d).findByRole("heading", { name: /^Same effect/ });
  fireEvent.click(screen.getByText("shut"));
  fireEvent.click(screen.getByText("again"));
  expect(await within(await drawer()).findByRole("heading", { name: /^Same effect/ })).toBeInTheDocument();
  expect(redundancy).toHaveBeenCalledTimes(1);
});

test("no button when the report registers no redundancy, none on a token", async () => {
  const { unmount } = render(<Host />);
  expect(within(await drawer()).queryByRole("button", { name: /redundancy/i })).toBeNull();
  unmount();
  render(<Host redundancy={async () => result([])} token="Treasure" />);
  await drawer();
  expect(screen.queryByRole("button", { name: /redundancy/i })).toBeNull();
});

test("the card menu offers the line only with the extra registered, and it opens the card and starts the search", async () => {
  function Lines({ out }: { out: { labels: string[]; run?: () => void } }) {
    const lines = useCardMenu();
    const l = lines("Reducer");
    out.labels = l.map((x) => x.label);
    out.run = l.find((x) => x.label === "Find redundancy in this deck")?.run;
    return null;
  }
  const without = { labels: [] as string[], run: undefined as (() => void) | undefined };
  const a = render(<Host open=""><Lines out={without} /></Host>);
  expect(without.labels).not.toContain("Find redundancy in this deck");
  a.unmount();
  const redundancy = vi.fn(async () => result(HITS));
  const out = { labels: [] as string[], run: undefined as (() => void) | undefined };
  render(<Host open="" redundancy={redundancy}><Lines out={out} /></Host>);
  await waitFor(() => expect(out.run).toBeDefined());
  act(() => out.run!());
  const d = await drawer();
  expect(await within(d).findByRole("heading", { name: /^Same effect/ })).toBeInTheDocument();
  expect(redundancy).toHaveBeenCalledWith("Reducer");
});

/** A RE-ANALYSED DECK RESETS THE SECTION: the old deck's hits are not this deck's, and the old search must not land in it. */
const swapDeck = engineDeck();
const swapModel = buildEngineModel(swapDeck.report, swapDeck.graph);
function SwapRegister({ find }: { find: NonNullable<DrawerExtras["redundancy"]> }) {
  const { setExtras, open } = useCardDrawer();
  useEffect(() => { open("Reducer"); }, [open]);
  useEffect(() => { setExtras({ model: swapModel, redundancy: find }); }, [setExtras, find]);
  return null;
}
const Swap = ({ find }: { find: NonNullable<DrawerExtras["redundancy"]> }) =>
  <MemoryRouter><CardDrawerProvider graph={swapDeck.graph}><SwapRegister find={find} /></CardDrawerProvider></MemoryRouter>;

test("a new report's search resets the section; the old search resolving late does not land in it", async () => {
  let late!: (r: RedundancyResult) => void;
  const first = vi.fn(() => new Promise<RedundancyResult>((r) => { late = r; }));
  const second = vi.fn(async () => result(HITS));
  const { rerender } = render(<Swap find={first} />);
  await drawer();
  await userEvent.click(screen.getByRole("button", { name: "Find redundancy in this deck" }));
  rerender(<Swap find={second} />);
  expect(await screen.findByRole("button", { name: "Find redundancy in this deck" })).toBeInTheDocument();
  await act(async () => { late(result([hit("Stale Card", "same")])); });
  expect(screen.queryByText("Stale Card")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Find redundancy in this deck" }));
  await screen.findByRole("heading", { name: /^Same effect/ });
  rerender(<Swap find={vi.fn(async () => result([]))} />);
  expect(await screen.findByRole("button", { name: "Find redundancy in this deck" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /^Same effect/ })).toBeNull();
});

test("a card the search cannot compare says so, not 'none in your colours'", async () => {
  render(<Host redundancy={async () => result([], false)} />);
  const d = await drawer();
  await userEvent.click(within(d).getByRole("button", { name: "Find redundancy in this deck" }));
  expect(await within(d).findByText("This card has no effect the search can compare.")).toBeInTheDocument();
  expect(within(d).queryByText(/No card in your colours/)).toBeNull();
});

test("'Show N more' moves focus to the first revealed row; results move focus to the section heading", async () => {
  const many = Array.from({ length: 11 }, (_, i) => hit(`Card ${i + 1}`, "close"));
  render(<Host redundancy={async () => result(many)} />);
  const d = await drawer();
  await userEvent.click(within(d).getByRole("button", { name: "Find redundancy in this deck" }));
  const title = await within(d).findByRole("heading", { level: 4, name: "Redundancy in this deck" });
  await waitFor(() => expect(title).toHaveFocus());
  expect(within(d).getByRole("heading", { level: 5, name: /^Close variants/ })).toBeInTheDocument();
  await userEvent.click(within(d).getByRole("button", { name: "Show 6 more" }));
  await waitFor(() => expect(within(d).getByRole("link", { name: "Card 6" })).toHaveFocus());
});

test("a tier whose rows all share the same count says it once in its heading; mixed counts show per row", async () => {
  const a = hit("Alpha", "close", [chip("shared", "x")], { sharedPartners: sp(9) });
  const b = hit("Beta", "close", [chip("shared", "x"), chip("deck", "in your deck")], { sharedPartners: sp(9) });
  const c = hit("Gamma", "same", [chip("shared", "x")], { sharedPartners: sp(4) });
  const e = hit("Delta", "same", [chip("shared", "x")], { sharedPartners: sp(9) });
  render(<Host redundancy={async () => result([a, b, c, e], undefined, 9)} />);
  const d = await drawer();
  await userEvent.click(within(d).getByRole("button", { name: "Find redundancy in this deck" }));
  expect(await within(d).findByRole("heading", { name: "Close variants · 2 · all work with 9 of 9" })).toBeInTheDocument();
  const close = within(d).getByRole("link", { name: "Alpha" }).closest("ul")!;
  expect(within(close).queryByText(/works with/)).toBeNull();
  expect(within(d).getByRole("heading", { name: "Same effect · 2" })).toBeInTheDocument();
  const same = within(d).getByRole("link", { name: "Gamma" }).closest("ul")!;
  expect(within(same).getByText("works with 4 of 9 of the same deck cards")).toBeInTheDocument();
  expect(within(same).getByText("works with 9 of 9 of the same deck cards")).toBeInTheDocument();
});

test("the section is the drawer's last block", async () => {
  render(<Host redundancy={async () => result(HITS)} />);
  const d = await drawer();
  const section = within(d).getByTestId("drawer-redundancy");
  expect(d.lastElementChild === section || d.lastElementChild!.contains(section)).toBe(true);
});

test("the intro keys the figure, and the heading is scrolled to the top of the rail once results render", async () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  render(<Host redundancy={async () => result(HITS)} />);
  const d = await drawer();
  await userEvent.click(within(d).getByRole("button", { name: "Find redundancy in this deck" }));
  await within(d).findByRole("heading", { level: 4, name: "Redundancy in this deck" });
  expect(within(d).getByText(/The figure is how many of the same deck cards each one works with/)).toBeInTheDocument();
  await waitFor(() => expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" }));
  const title = within(d).getByRole("heading", { level: 4, name: "Redundancy in this deck" });
  expect(scroll.mock.contexts).toContain(title);
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

test("a companion gets neither the button nor the menu line; a main-deck card still does", async () => {
  function Lines({ out }: { out: { labels: string[] } }) {
    const lines = useCardMenu();
    out.labels = [...lines("Reducer"), ...lines("Payoff A")].map((x) => x.label);
    return null;
  }
  const out = { labels: [] as string[] };
  const { unmount } = render(<Host redundancy={async () => result([])} companion="Reducer"><Lines out={out} /></Host>);
  expect(within(await drawer()).queryByRole("button", { name: /redundancy/i })).toBeNull();
  // Reducer (the companion) offers no line; Payoff A, in the main deck, does -- exactly one line in all.
  expect(out.labels.filter((l) => l === "Find redundancy in this deck")).toHaveLength(1);
  unmount();
  render(<Host redundancy={async () => result([])} open="Payoff A" companion="Reducer" />);
  expect(within(await drawer()).getByRole("button", { name: "Find redundancy in this deck" })).toBeInTheDocument();
});

test("a rejection after an earlier success is an error with retry, and is not cached", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const redundancy = vi.fn().mockResolvedValueOnce(result(HITS)).mockRejectedValueOnce(new Error("events shards unreachable")).mockResolvedValueOnce(result(HITS));
  render(<Host redundancy={redundancy} open="Reducer" />);
  const d = await drawer();
  await userEvent.click(within(d).getByRole("button", { name: "Find redundancy in this deck" }));
  await within(d).findByRole("heading", { name: /^Same effect/ });
  cleanup();
  // A different card on the same search function: its rejection is shown, then retried.
  render(<Host redundancy={redundancy} open="Payoff A" />);
  const d2 = await drawer();
  await userEvent.click(within(d2).getByRole("button", { name: "Find redundancy in this deck" }));
  expect(await within(d2).findByText(/couldn't load/i)).toBeInTheDocument();
  await userEvent.click(within(d2).getByRole("button", { name: "Try again" }));
  expect(await within(d2).findByRole("heading", { name: /^Same effect/ })).toBeInTheDocument();
  expect(redundancy).toHaveBeenCalledTimes(3);
});
