import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { DeckWaffle } from "./DeckWaffle.js";
import { CardDrawerProvider, usePinned } from "./card-drawer.js";
import { TYPE_ORDER } from "../lib/deck-shape.js";
import type { WaffleSquare } from "../lib/waffle.js";

const SLICES = [
  { type: "creature", count: 21 },
  { type: "enchantment", count: 19 },
  { type: "instant", count: 12 },
  { type: "artifact", count: 9 },
  { type: "sorcery", count: 5 },
];

const sq = (s: Partial<WaffleSquare>): WaffleSquare =>
  ({ name: "x", type: "creature", state: "read", isCommander: false, ...s });

const SOME = [sq({}), sq({ type: "sorcery" }), sq({ type: null })];
/** THE GRID ONLY EXISTS WHERE THERE IS COVERAGE TO MAP (S15), so every test about the grid's
 *  geometry needs a deck with something to mark. One unread square is the smallest such deck, and
 *  it is added rather than the rule being relaxed -- the geometry tests are about the grid, and a
 *  fixture that no longer renders one would pass for the wrong reason. */
const withUnread = (squares: WaffleSquare[]): WaffleSquare[] => [...squares, sq({ state: "unread" })];

// ONE SQUARE PER CARD IS THE WHOLE CONCEIT. The grid is a picture of the deck's real size, so the
// count of squares is the count of cards -- a reader who doubts any number here can count them.
test("draws one square per card it was given", () => {
  render(<DeckWaffle squares={withUnread(SOME)} slices={SLICES} />);
  expect(screen.getAllByTestId("waffle-square")).toHaveLength(4);
});

/** THE GRID IS A COVERAGE MAP AND NOTHING ELSE (roadmap S15, owner call 2026-09-02). With every
 *  card read and resolved there is no hatch and no hollow square, so the 465px of squares are a
 *  picture of the counts its own legend prints three lines below -- ahead of every verdict on the
 *  page, on the ~99%-derived decks that are the common case. The CENSUS is not what goes: the
 *  total line and the per-type legend both stay, which is where those numbers were readable. */
test("the grid renders only when something is unread or unresolved", () => {
  const { rerender } = render(<DeckWaffle squares={SOME} slices={SLICES} lands={34} />);
  expect(screen.queryByTestId("waffle-grid")).toBeNull();
  expect(screen.queryAllByTestId("waffle-square")).toHaveLength(0);
  // ...and the census survives in full.
  expect(screen.getByTestId("type-total")).toHaveTextContent("66");
  expect(screen.getByTestId("type-legend-creature")).toBeInTheDocument();
  expect(screen.getByTestId("type-legend-land")).toHaveTextContent("34");

  // A COLOUR CHIP WITH NO GRID KEYS NOTHING, which is the same defect as a key for a state
  // nothing on screen is in. The counts stay; the swatches go with the squares they point at.
  expect(screen.getByTestId("type-legend-creature").querySelector("span[aria-hidden]")).toBeNull();

  rerender(<DeckWaffle squares={withUnread(SOME)} slices={SLICES} lands={34} />);
  expect(screen.getByTestId("waffle-grid")).toBeInTheDocument();
  expect(screen.getAllByTestId("waffle-square")).toHaveLength(4);
  expect(screen.getByTestId("type-legend-creature").querySelector("span[aria-hidden]")).not.toBeNull();
});

/** A SQUARE SIZES ITSELF FROM ITS COLUMN, NEVER FROM ITS ROW, and this is a regression test for a
 *  defect jsdom cannot see -- which is the point of writing it as a class contract rather than as
 *  geometry. `block-size: 100%` on a grid item resolves against an indefinite row and collapses to
 *  zero: measured in the browser on a real 100-card deck, `grid-template-rows` came back
 *  `39px 39px 0px 0px ...` with 83 of 99 squares at height 0, so a hundred-card deck painted as two
 *  rows and every automated gate passed. The column track is definite (1fr of a capped width), so
 *  `aspect-square` is what gives each row a real height.
 *
 *  It is a proxy and it is labelled as one: the honest check is the browser measurement recorded
 *  above (11 rows, 0 zero-height squares, 39x39 squares, an 82x82 commander spanning exactly two
 *  columns plus the gap). This only stops the one property whose removal caused it. */
test("every square sizes from its column, so no grid row can collapse", () => {
  render(<DeckWaffle squares={withUnread(SOME)} slices={SLICES} />);
  for (const el of screen.getAllByTestId("waffle-square")) {
    expect(el.className).toContain("aspect-square");
    expect(el.style.blockSize).toBe("");
  }
});

// ONE CARD, ONE CELL, AND THE COMMANDER IS NOT AN EXCEPTION -- the property the whole chart exists
// to have. It shipped as a 2x2 span and a tuner counting the grid to check the deck's size got 103
// for a hundred-card deck, then had to reconcile against the header: "I only knew to do that
// subtraction because the caption says the large square is one card".
test("the commander is one cell like every other card, ringed rather than enlarged", () => {
  render(<DeckWaffle squares={withUnread([sq({ name: "Krenko, Mob Boss", isCommander: true }), sq({})])} slices={SLICES} />);
  const cells = screen.getAllByTestId("waffle-square");
  expect(cells).toHaveLength(3);
  for (const c of cells) {
    expect(c.className).not.toContain("col-span");
    expect(c.className).not.toContain("row-span");
  }
  const cmd = cells.find((c) => c.dataset.commander === "1")!;
  expect(cmd.className).toContain("outline");
  // A REAL NAME, NOT A TOOLTIP (S8). `title` does not exist on touch at all, so on a phone this
  // grid was a hundred unlabelled cells -- Section R's complaint about it.
  expect(cmd).toHaveAccessibleName("Krenko, Mob Boss, commander");
  expect(screen.getByText(/The ringed square is/)).toHaveTextContent("Krenko, Mob Boss");
});

// COUNTING THE CELLS HAS TO GIVE THE DECK'S SIZE. The one property everything above rests on,
// asserted with a commander present because that is the case that broke it.
test("the cell count is the card count, commander included", () => {
  const deck = [sq({ isCommander: true }), sq({ state: "unread" }), ...Array.from({ length: 98 }, () => sq({}))];
  render(<DeckWaffle squares={deck} slices={SLICES} />);
  expect(screen.getAllByTestId("waffle-square")).toHaveLength(100);
});

// --- ported from TypeBar, which this replaces. The census line is checked data and moved verbatim.

test("prints the nonland total, which is the whole the types are parts of", () => {
  render(<DeckWaffle squares={SOME} slices={SLICES} />);
  expect(screen.getByTestId("type-total")).toHaveTextContent("66");
});

test("every type is named in text with its count, never colour alone", () => {
  render(<DeckWaffle squares={SOME} slices={SLICES} />);
  for (const s of SLICES) {
    expect(screen.getByTestId(`type-legend-${s.type}`)).toHaveTextContent(String(s.count));
    expect(screen.getByTestId(`type-legend-${s.type}`)).toHaveTextContent(s.type);
  }
});

/** THE LEGEND ORDER IS THE COLOUR GUARANTEE. `enchantment` and `sorcery` are both blues below the
 *  normal-vision separation floor; the palette passes only because they are never adjacent. */
test("the legend renders in TYPE_ORDER, not sorted by size", () => {
  render(<DeckWaffle squares={SOME} slices={SLICES} />);
  const rendered = [...document.querySelectorAll('[data-testid^="type-legend-"]')]
    .map((el) => el.getAttribute("data-testid")!.replace("type-legend-", ""))
    .filter((t) => t !== "land");
  expect(rendered).toEqual(TYPE_ORDER.filter((t) => SLICES.some((s) => s.type === t)));
  expect(rendered).not.toEqual([...SLICES].sort((a, b) => b.count - a.count).map((s) => s.type));
});

test("prints the land count beside the nonland total", () => {
  render(<DeckWaffle squares={SOME} slices={[{ type: "creature", count: 21 }]} lands={38} />);
  expect(screen.getByText(/lands/)).toBeInTheDocument();
  expect(screen.getByTestId("type-total").closest("p")!).toHaveTextContent("38 lands");
});

test("says nothing about lands when the count is unknown", () => {
  render(<DeckWaffle squares={SOME} slices={[{ type: "creature", count: 21 }]} />);
  expect(screen.queryByText(/lands/)).toBeNull();
});

/** The reconciliation `docs/engineering-log/2026-08-31.md` established for `BuildBenchmarks`
 *  ("34 (38 with MDFCs)"): a modal DFC with a land back is a land to the mana model and a spell to
 *  this census, on purpose, and the gap is named rather than left for a reader to sum. */
test("prints the MDFC reconciliation beside the land count", () => {
  render(<DeckWaffle squares={SOME} slices={SLICES} lands={34} mdfc={4} />);
  // T3, OWNER 2026-09-02, READING THE S16 VERSION: *"(38 counting MDFC backs, which is the figure
  // the mana model uses)" is over-explained. "38 with MDFCs" is enough.* S16's job survives the cut
  // — the bigger number is still ON this line, which is what stopped a reader meeting 34 here and
  // 38 in every later chapter with nothing to bridge them. What goes is the clause naming WHOSE
  // figure it is, and the owner ruled that after reading the long form on the deployed site.
  expect(screen.getByTestId("type-total").closest("p")!).toHaveTextContent("34 lands (38 with MDFCs)");
  expect(screen.getByTestId("type-total").closest("p")!).not.toHaveTextContent("mana model uses");
  // AND IT MUST STILL BE ABLE TO WRAP. The clause carried `whitespace-nowrap` back when it was this
  // short, and it was the page's only 390px overflow once S16 grew it (`scrollWidth` 526 against a
  // 390 client width, on the example deck). It is short again — the class does NOT come back, since
  // nothing measured it as needed and cause 4 in the narrow-width rules is exactly this span.
  expect(screen.getByText(/with MDFCs/).className).not.toMatch(/nowrap/);
});

test("says nothing about MDFCs when there are none, rather than a parenthetical about nothing", () => {
  render(<DeckWaffle squares={SOME} slices={SLICES} lands={34} mdfc={0} />);
  const line = screen.getByTestId("type-total").closest("p")!;
  expect(line).toHaveTextContent("34 lands");
  expect(line).not.toHaveTextContent("MDFC");
});

test("renders nothing at all rather than an empty grid", () => {
  const { container } = render(<DeckWaffle squares={[]} slices={SLICES} />);
  expect(container).toBeEmptyDOMElement();
});

// --- the coverage half, which the bar could not say at all.

// A CARD THAT RESOLVED AND CARRIES NO DERIVED TAGS IS STILL A CREATURE. The hatch rides ON the
// type fill rather than replacing it -- hiding the type would overstate the gap. Same convention,
// and the same `hatchImage`, the graph paints (S1).
test("hatches the cards the engine could not read, over their own type", () => {
  render(<DeckWaffle squares={[sq({ state: "unread", type: "enchantment" }), sq({})]} slices={SLICES} />);
  const marked = screen.getAllByTestId("waffle-square").filter((s) => s.dataset.state === "unread");
  expect(marked).toHaveLength(1);
  expect(marked[0]!.dataset.type).toBe("enchantment");
  expect(marked[0]!.style.backgroundImage).toContain("repeating-linear-gradient");
});

// TWO FAILURES, NOT ONE. Unresolved never reached the corpus and is usually a typo; unread
// resolved and was not understood. Only the first is fixable by editing the list.
test("draws an unresolved card hollow, distinct from an unread one", () => {
  render(<DeckWaffle squares={[sq({ state: "unresolved", type: null }), sq({ state: "unread" })]} slices={SLICES} />);
  const states = screen.getAllByTestId("waffle-square").map((s) => s.dataset.state);
  expect(states).toEqual(expect.arrayContaining(["unresolved", "unread"]));
  expect(screen.getByTestId("waffle-legend-unresolved")).toHaveTextContent("1");
  expect(screen.getByTestId("waffle-legend-unread")).toHaveTextContent("1");
});

// A KEY FOR A STATE NOTHING ON SCREEN IS IN EXPLAINS NOTHING -- the same rule `DerivedMark`,
// `CoveragePanel` and the bracket pips all ship under.
test("a fully read deck carries neither coverage key", () => {
  render(<DeckWaffle squares={SOME} slices={SLICES} />);
  expect(screen.queryByTestId("waffle-legend-unread")).toBeNull();
  expect(screen.queryByTestId("waffle-legend-unresolved")).toBeNull();
});

// THE COMMANDER IS THE RECOGNITION ANCHOR -- the first thing an EDH player checks to see whether
// the tool read the right deck -- and one square among a hundred cannot be that.
// THE IDENTITY PIPS ARE NOT REPEATED HERE. `RecognitionPanel`'s byline prints them three lines
// above ("Nalia de'Arnise · pips · Orzhov"), so a pair inside the commander's square was a third
// copy of one fact -- and it was costing the cell that broke the count.
test("the waffle draws no mana symbols: the byline above already carries the identity", () => {
  const { container } = render(
    <DeckWaffle squares={[sq({ isCommander: true }), sq({})]} slices={SLICES} />,
  );
  expect(container.querySelector("img, svg")).toBeNull();
});

// THE WHOLE GRID IS ONE IMAGE TO A SCREEN READER, and its label carries every figure the sighted
// reader gets by counting -- including both coverage states, which are the point of the panel.
test("the grid reads out its own census and both coverage states", () => {
  render(
    <DeckWaffle
      squares={[sq({ state: "unread" }), sq({ state: "unresolved", type: null }), sq({})]}
      slices={SLICES}
      lands={34}
    />,
  );
  const label = screen.getByTestId("waffle-grid").getAttribute("aria-label")!;
  expect(label).toContain("21 creature");
  expect(label).toContain("34 lands");
  expect(label).toContain("1 the engine could not read");
  expect(label).toContain("1 not found at all");
});

/** S8 FOLD-IN. The square carried a tooltip and nothing else; it becomes a control that opens the
 *  card, which is also the only way to reach the pin. Measured before making it tappable: the grid
 *  is `repeat(10, ...)` inside max-w-[420px] with a 3px gap, so a square is about 39px on desktop
 *  and about 30px inside a 390px viewport -- both over the 24px target floor (WCAG 2.5.8). */
test("a waffle square is a named control, not a tooltip", () => {
  render(<DeckWaffle squares={withUnread([sq({ name: "Sol Ring" })])} slices={SLICES} />);
  const cell = screen.getAllByTestId("waffle-square").find((c) => c.getAttribute("aria-label") === "Sol Ring")!;
  expect(cell.tagName).toBe("BUTTON");
  expect(cell).not.toHaveAttribute("title");
});

/** THE COMMANDER ALREADY WORE A RING, and one square cannot carry two inset outlines. Pinned wins;
 *  no fact is lost, because the panel's byline three lines above already names the commander --
 *  which is exactly why its identity pips were deleted when that ring shipped. */
test("a pinned square rings in the accent, and a pinned commander shows only that ring", async () => {
  const graph = {
    nodes: [{ id: "Krenko, Mob Boss", label: "Krenko, Mob Boss", copies: 1, types: [], subtypes: [], supertypes: [], colors: [], cmc: 4 }],
    edges: [],
  } as never;
  function Pinner() {
    const { togglePin } = usePinned();
    return <button onClick={() => togglePin("Krenko, Mob Boss")}>pin it</button>;
  }
  render(
    <CardDrawerProvider graph={graph}>
      <DeckWaffle squares={withUnread([sq({ name: "Krenko, Mob Boss", isCommander: true }), sq({})])} slices={SLICES} />
      <Pinner />
    </CardDrawerProvider>,
  );
  await userEvent.click(screen.getByText("pin it"));
  const cell = document.querySelector('[data-testid="waffle-square"][data-pinned="1"]')!;
  expect(cell.className).toContain("outline-(--accent)");
  expect(cell.className).not.toContain("outline-(--foreground)");
  // The mark is never the only carrier.
  expect(cell.getAttribute("aria-label")).toContain("pinned");
});
