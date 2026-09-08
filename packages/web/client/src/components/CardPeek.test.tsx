import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { CardPeek } from "./CardPeek.js";
import { PeekContext, usePeekState } from "./peek.js";
import type { CardPageData } from "../lib/partners.js";

/** THE PEEK PANEL (spec 2026-09-08 part 3): opens on the card, focuses Close, marks the document
 *  for the phone scroll lock, never moves the URL; a name inside looks further, Back returns one,
 *  Close returns focus to the row that opened the first look, Escape closes. */
const record = (name: string, partners: CardPageData["partners"] = []): CardPageData => ({
  name, typeLine: "Artifact", manaCost: "{1}", artCrop: "https://cards.scryfall.io/art_crop/front/1/1/x.jpg",
  backArtCrop: null, abilities: [], identity: [], commander: false, emits: [], demands: [],
  partners, pool: {}, rarity: {},
});
const SKULL = record("Skullclamp", [
  { name: "Impact Tremors", slug: "impact-tremors", score: 0.2, event: "dies|creature|-|-", reason: "reason one" },
]);
const TREMORS = record("Impact Tremors");
const load = vi.fn(async (slug: string) => slug === "skullclamp" ? SKULL : slug === "impact-tremors" ? TREMORS : null);

function Where() { const { pathname } = useLocation(); return <p data-testid="where">{pathname}</p>; }
function Harness() {
  const peek = usePeekState();
  return (
    <PeekContext.Provider value={peek}>
      <button type="button" onClick={(ev) => peek.push("skullclamp", ev.currentTarget)}>opener</button>
      <CardPeek load={load} />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </PeekContext.Provider>
  );
}
const mount = () => render(<MemoryRouter initialEntries={["/cards/krenko-mob-boss"]}><Harness /></MemoryRouter>);
afterEach(() => { document.documentElement.classList.remove("peek-open"); });

test("a push opens the panel on the card, focuses Close, marks the document, moves no URL", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "opener" }));
  await screen.findByRole("dialog", { name: "Skullclamp" });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" })));
  expect(document.documentElement.classList.contains("peek-open")).toBe(true);
  expect(screen.getByRole("link", { name: "Open Skullclamp" })).toHaveAttribute("href", "/cards/skullclamp");
  expect(screen.getByTestId("where").textContent).toBe("/cards/krenko-mob-boss");
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
});

test("a partner inside the panel peeks further, Back returns, Close returns focus and unmarks", async () => {
  mount();
  const opener = screen.getByRole("button", { name: "opener" });
  fireEvent.click(opener);
  await screen.findByRole("dialog", { name: "Skullclamp" });
  fireEvent.click(screen.getByRole("button", { name: "Impact Tremors" }));
  await screen.findByRole("dialog", { name: "Impact Tremors" });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByRole("dialog", { name: "Skullclamp" });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(opener);
  expect(document.documentElement.classList.contains("peek-open")).toBe(false);
});

test("Escape closes", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "opener" }));
  const dialog = await screen.findByRole("dialog", { name: "Skullclamp" });
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("a slug the corpus does not hold says so and still offers Close", async () => {
  render(
    <MemoryRouter>
      <PeekContext.Provider value={{ stack: ["nope"], push: vi.fn(), back: vi.fn(), close: vi.fn() }}>
        <CardPeek load={load} />
      </PeekContext.Provider>
    </MemoryRouter>,
  );
  await screen.findByText(/not in the corpus/);
  expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
});
