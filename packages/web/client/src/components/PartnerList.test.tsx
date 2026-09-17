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

/** A FEEDER CAPTION LEAVES BOTH NAMES OUT (phone review, 2026-09-17): the tile shows the row's card
 *  and the page says whose page it is, so the two clamped lines go to what happens. */
test("a feeder row's caption is the sentence minus the two names it already shows", () => {
  render(
    <MemoryRouter>
      <PartnerList subject="Krenko, Mob Boss" pool={{}} rarity={{}} empty="none" rows={[{
        name: "Guttersnipe", slug: "guttersnipe", score: 0.1, event: "counts|creature|goblin|-",
        reason: "While you control Guttersnipe, Krenko, Mob Boss counts it and makes more tokens",
      }]} />
    </MemoryRouter>,
  );
  expect(screen.getByText("counts it and makes more tokens")).toBeInTheDocument();
});

test("a feeder group's withheld line says feed, a payoff group's says ask", () => {
  render(
    <MemoryRouter>
      <PartnerList subject="Krenko, Mob Boss" pool={{ "counts|creature|goblin|-": 9, "enters|creature|-|-": 5 }} rarity={{}} empty="none" rows={[
        { name: "Guttersnipe", slug: "guttersnipe", score: 0.2, event: "counts|creature|goblin|-", reason: "While you control Guttersnipe, Krenko, Mob Boss counts it and makes more tokens" },
        { name: "Impact Tremors", slug: "impact-tremors", score: 0.1, event: "enters|creature|-|-", reason: "When a goblin enters thanks to Krenko, Impact Tremors deals 1 damage", payoff: "deals 1 damage" },
      ]} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/other cards feed it too/)).toBeInTheDocument();
  expect(screen.getByText(/other cards ask for it too/)).toBeInTheDocument();
});

/** AN UNREAD ROW SHOWS THE LIMIT, NOT A PAYOFF. "triggers" over "engine did not read what it does"
 *  read as the payoff with a footnote (UX review, 2026-09-17); the engine knows only that the card
 *  triggers, so the caption slot says that and nothing else. */
test("an unread row's caption is the limit alone", () => {
  render(
    <MemoryRouter>
      <PartnerList subject="Krenko, Mob Boss" pool={{}} rarity={{}} empty="none" rows={[{
        name: "Mystery", slug: "mystery", score: 0.1, event: "enters|creature|-|-",
        reason: "When a Goblin enters thanks to Krenko, Mystery triggers", payoff: "triggers", unread: true,
      }]} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/engine did not read what it does/)).toBeInTheDocument();
  expect(screen.queryByText("triggers")).toBeNull();
});
