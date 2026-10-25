import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import type { RedundancyResult } from "@edh-seer/matcher/redundancy-static";
import { buildEngineModel } from "../lib/engine-model.js";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { CardDrawerProvider, useCardDrawer, type DrawerExtras } from "./card-drawer.js";
import { useCardMenu } from "./card-menu.js";

const chip = (dim: "deck" | "shared" | "amplifier", label: string) => ({ dim, label });
const hit = (name: string, tier: "same" | "close" | "output" | "outcome", deckChips: ReturnType<typeof chip>[] = [], extra: object = {}) =>
  ({ id: 1, name, slug: name.toLowerCase().replace(/ /g, "-"), tier, chips: [], score: 1, inDeck: false, sharedPartners: [], deckChips, ...extra });
const result = (hits: object[]): RedundancyResult => ({ hits, poolSize: 3, seedPartners: [], amplifiers: [], stats: { buckets: [], bucketSizes: [], poolSize: 0, fetched: 0, fallbacks: [], missing: [] } }) as unknown as RedundancyResult;

const HITS = [
  hit("Witty Roastmaster", "close", [chip("deck", "in your deck"), chip("shared", "shares 2 of 2 partners")], { inDeck: true }),
  hit("Warstorm Surge", "same", [chip("shared", "shares 1 of 2 partners")]),
  hit("Corpse Knight", "outcome", [chip("amplifier", "loses synergy with Fiery Emancipation")]),
];

function Host({ redundancy, open = "Reducer", token, children }: { redundancy?: DrawerExtras["redundancy"]; open?: string; token?: string; children?: React.ReactNode }) {
  const { report, graph } = engineDeck();
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
  expect(await within(d).findByRole("heading", { name: "Same effect" })).toBeInTheDocument();
  expect(within(d).getByRole("heading", { name: "Close variants" })).toBeInTheDocument();
  expect(within(d).getByRole("heading", { name: "Same outcome, different event" })).toBeInTheDocument();
  expect(within(d).getByText("in your deck")).toBeInTheDocument();
  expect(within(d).getByText("shares 2 of 2 partners")).toBeInTheDocument();
  expect(within(d).getByText("loses synergy with Fiery Emancipation")).toBeInTheDocument();
  expect(within(d).getByRole("link", { name: "Warstorm Surge" })).toHaveAttribute("href", "/cards/warstorm-surge");
  expect(within(d).getByText(/do the same job as Reducer/)).toBeInTheDocument();
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
  expect(await within(d).findByRole("heading", { name: "Same effect" })).toBeInTheDocument();
  expect(redundancy).toHaveBeenCalledTimes(2);
});

test("no hits says no card in the colours does the job, with no empty heading", async () => {
  render(<Host redundancy={async () => result([])} />);
  const d = await drawer();
  await userEvent.click(within(d).getByRole("button", { name: "Find redundancy in this deck" }));
  expect(await within(d).findByText(/No card in your colours does the same job/)).toBeInTheDocument();
  expect(within(d).queryByRole("heading", { name: "Same effect" })).toBeNull();
});

test("a long tier shows 8, then 'Show N more'", async () => {
  const many = Array.from({ length: 11 }, (_, i) => hit(`Card ${i + 1}`, "close"));
  render(<Host redundancy={async () => result(many)} />);
  const d = await drawer();
  await userEvent.click(within(d).getByRole("button", { name: "Find redundancy in this deck" }));
  await within(d).findByRole("heading", { name: "Close variants" });
  expect(within(d).getAllByRole("listitem")).toHaveLength(8);
  await userEvent.click(within(d).getByRole("button", { name: "Show 3 more" }));
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
  await within(d).findByRole("heading", { name: "Same effect" });
  fireEvent.click(screen.getByText("shut"));
  fireEvent.click(screen.getByText("again"));
  expect(await within(await drawer()).findByRole("heading", { name: "Same effect" })).toBeInTheDocument();
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
  expect(await within(d).findByRole("heading", { name: "Same effect" })).toBeInTheDocument();
  expect(redundancy).toHaveBeenCalledWith("Reducer");
});
