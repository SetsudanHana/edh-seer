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

/** THE FIXTURE CARRIED THE DEFECT (fixed 2026-09-19). Both counts used to sit in `pool` and the
 *  component read `pool` for every group, so this passed while the feeder line printed a figure
 *  counted from the cards that ASK for the event. A feeder SUPPLIES it, so its count comes from
 *  `rarity` -- measured on Sanctum of Fruitful Harvest's `counts|-|shrine` (rarity 22, pool 21).
 *  The payoff group's stays in `pool`, which was always the right map for rows that ask. */
test("a feeder group's withheld line says feed, a payoff group's says ask", () => {
  render(
    <MemoryRouter>
      <PartnerList subject="Krenko, Mob Boss" pool={{ "enters|creature|-|-": 5 }} rarity={{ "counts|creature|goblin|-": 9 }} empty="none" rows={[
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
  expect(screen.getByText(/couldn.t read this card/)).toBeInTheDocument();
  expect(screen.queryByText("triggers")).toBeNull();
});

/** ONE ROW PER GROUP ON A PHONE (UX review, 2026-09-17: 9.6 screens, Partners at 1,335px). Every
 *  tile stays in the document; below `sm` the ones past the first row hide until asked for, and
 *  the button that asks says how many it holds. jsdom applies no stylesheet, so the class is the
 *  assertion. */
test("a group past one phone row hides the rest behind a button that says how many", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    name: `Payoff ${i}`, slug: `payoff-${i}`, score: 0.1, event: "enters|creature|-|-",
    reason: `When a Goblin enters, Payoff ${i} triggers`, payoff: "triggers",
  }));
  render(<MemoryRouter><PartnerList pool={{}} rarity={{}} empty="none" rows={rows} /></MemoryRouter>);
  const items = screen.getAllByRole("listitem");
  expect(items).toHaveLength(5);
  expect(items.slice(0, 3).some((li) => li.className.includes("max-sm:hidden"))).toBe(false);
  expect(items.slice(3).every((li) => li.className.includes("max-sm:hidden"))).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
  expect(screen.getAllByRole("listitem").some((li) => li.className.includes("max-sm:hidden"))).toBe(false);
  expect(screen.queryByRole("button", { name: /Show \d+ more/ })).toBeNull();
});

/** A PRODUCER ROW RUNS TOWARD THE PAGE'S CARD (owner 2026-09-17, "payoff pages omit producers"):
 *  the tile is a card that CAUSES the event the page's card asks for, so its withheld line says
 *  "cause it", and the tile carries that direction as its note rather than a payoff of its own.
 *
 *  ITS COUNT COMES FROM `rarity` (2026-09-19): the rows supply the event, so the honest denominator
 *  is how many cards CAN CAUSE it, not how many ask. This fixture had the figure in `pool` and
 *  passed because the component read `pool` for every direction. */
test("a producer group's withheld line says cause, and its tiles say they cause it", () => {
  render(
    <MemoryRouter>
      <PartnerList subject="Impact Tremors" pool={{}} rarity={{ "enters|creature|-|-": 4 }} empty="none" rows={[{
        name: "Krenko, Mob Boss", slug: "krenko-mob-boss", score: 0.2, event: "enters|creature|-|-",
        reason: "When a goblin enters thanks to Krenko, Mob Boss, Impact Tremors deals 1 damage", producer: true,
      }]} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/other cards cause it too/)).toBeInTheDocument();
  expect(screen.getByText("causes it")).toBeInTheDocument();
  expect(screen.queryByText(/deals 1 damage/)).toBeNull();
});

/** THE CAUSE COUNT SAYS WHOSE IT IS under a group of askers (owner, 2026-09-22). Inalla's page read
 *  "17 cards can cause this" over one Diviner's Wand, and the deck-build agent took the 17 for tiles
 *  it could not see. The askers are partners because this page's card causes the event, so it is
 *  one of the 17; a producer group's tiles ARE causers and keep the bare count. */
test("an asker group's cause count names this page's card among the causes; a producer group's does not", () => {
  const asker = render(
    <MemoryRouter>
      <PartnerList subject="Inalla, Archmage Ritualist" pool={{}} rarity={{ "enters|creature|wizard|-": 17 }} empty="none" rows={[{
        name: "Diviner's Wand", slug: "diviners-wand", score: 0.2, event: "enters|creature|wizard|-",
        reason: "Whenever a Wizard creature enters, Diviner's Wand may attach to it",
      }]} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/cards can cause this, Inalla, Archmage Ritualist among them/)).toBeInTheDocument();
  asker.unmount();
  render(
    <MemoryRouter>
      <PartnerList subject="Impact Tremors" pool={{}} rarity={{ "enters|creature|-|-": 4 }} empty="none" rows={[{
        name: "Krenko, Mob Boss", slug: "krenko-mob-boss", score: 0.2, event: "enters|creature|-|-",
        reason: "When a goblin enters thanks to Krenko, Mob Boss, Impact Tremors deals 1 damage", producer: true,
      }]} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/cards can cause this$/)).toBeInTheDocument();
  expect(screen.queryByText(/among them/)).toBeNull();
});

// ---------------------------------------------------------------------------------------------
// THE WITHHELD COUNT IS A LINK (roadmap AJ3).
// ---------------------------------------------------------------------------------------------

/** THE NUMBER THAT WAS CLICKED IS THE NUMBER THAT LANDS. A producer group counts the cards that
 *  CAUSE the event, so its link asks `produce`; a consumer group counts the askers, so it asks
 *  `consume`. Sending both to the same param is the AJ1 defect with a URL on it. */
const EVENT = "applies:keyword-grant|creature|cleric|-";
const producerRows = [{
  name: "Akroma's Devoted", slug: "akromas-devoted", score: 0.15, event: EVENT, producer: true,
  reason: "Akroma's Devoted gives Samut an extra ability",
}];
const consumerRows = [{
  name: "Impact Tremors", slug: "impact-tremors", score: 0.1, event: "enters|creature|-|-",
  reason: "When a goblin enters thanks to Krenko, Impact Tremors deals 1 damage",
}];
const linkFor = (rows: typeof producerRows | typeof consumerRows, extra: Partial<Parameters<typeof PartnerList>[0]> = {}) => {
  render(
    <MemoryRouter initialEntries={["/commanders/samut-the-driving-force"]}>
      <PartnerList rows={rows} pool={{ [rows[0]!.event]: 40 }} rarity={{ [rows[0]!.event]: 589 }} empty="none" {...extra} />
    </MemoryRouter>,
  );
  const anchor = screen.getByRole("link", { name: /cards (cause|ask for|feed) it too/i });
  return new URL(anchor.getAttribute("href")!, "https://edhseer.cards");
};

test("a producer group's withheld count links to the cards that cause it", () => {
  const url = linkFor(producerRows);
  expect(url.pathname).toBe("/cards");
  expect(url.searchParams.getAll("produce")).toEqual([EVENT]);
  expect(url.searchParams.getAll("consume")).toEqual([]);
});

test("a consumer group links by consume, not produce", () => {
  const url = linkFor(consumerRows);
  expect(url.searchParams.getAll("consume")).toEqual(["enters|creature|-|-"]);
  expect(url.searchParams.getAll("produce")).toEqual([]);
});

/** ON A COMMANDER PAGE THE SET IS THE ONE ITS OWN DECK COULD PLAY, which is what AJ5 made the
 *  count mean. Without the colours the link would open a corpus-wide set under a scoped number. */
test("a commander page carries its identity into the link", () => {
  const url = linkFor(producerRows, { identity: ["R", "G", "W"] });
  expect(url.searchParams.get("colors")).toBe("RGW");
});

test("a card page carries no colours, because there is no deck there", () => {
  expect(linkFor(producerRows).searchParams.get("colors")).toBeNull();
});
