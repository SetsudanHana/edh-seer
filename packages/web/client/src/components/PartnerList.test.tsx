import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { expect, test, vi } from "vitest";
import { PartnerList } from "./PartnerList.js";
import { PeekContext, type PeekApi } from "./peek.js";

/** A PLAIN CLICK PEEKS, EVERYTHING ELSE NAVIGATES (spec 2026-09-08 part 3). The href stays the
 *  page: a crawler reads it, a middle click or a modifier opens it in a tab, copy-link copies it.
 *  Only the ordinary left click, the one that used to lose the reader's place, becomes a look. */
const ROWS = [{
  name: "Impact Tremors", slug: "impact-tremors", score: 0.1, event: "enters|creature|-|-",
  reason: "When a goblin enters thanks to Krenko, Impact Tremors deals 1 damage",
}];
function Where() { const { pathname } = useLocation(); return <p data-testid="where">{pathname}</p>; }
const mount = (peek: PeekApi | null) => render(
  <MemoryRouter initialEntries={["/cards/krenko-mob-boss"]}>
    <PeekContext.Provider value={peek}>
      <PartnerList rows={ROWS} pool={{}} rarity={{}} empty="none" />
    </PeekContext.Provider>
    <Routes><Route path="*" element={<Where />} /></Routes>
  </MemoryRouter>,
);
const api = (): PeekApi => ({ stack: [], push: vi.fn(), back: vi.fn(), close: vi.fn() });

test("inside a peek provider a plain click peeks and stays on the page", () => {
  const peek = api();
  mount(peek);
  const link = screen.getByRole("link", { name: "Impact Tremors" });
  fireEvent.click(link);
  expect(peek.push).toHaveBeenCalledWith("impact-tremors", link);
  expect(screen.getByTestId("where").textContent).toBe("/cards/krenko-mob-boss");
  expect(link).toHaveAttribute("href", "/cards/impact-tremors");
});

test("a modifier click navigates, and so does a middle click", () => {
  const peek = api();
  mount(peek);
  const link = screen.getByRole("link", { name: "Impact Tremors" });
  fireEvent.click(link, { metaKey: true });
  expect(peek.push).not.toHaveBeenCalled();
  fireEvent.click(link, { button: 1 });
  expect(peek.push).not.toHaveBeenCalled();
});

test("outside a provider a click navigates as before", () => {
  mount(null);
  fireEvent.click(screen.getByRole("link", { name: "Impact Tremors" }));
  expect(screen.getByTestId("where").textContent).toBe("/cards/impact-tremors");
});
