import { render, screen, fireEvent, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { CardDrawerProvider, CardName, ReasonText } from "./card-drawer.js";
import { ComboList } from "./ComboList.js";
import { MissingCards } from "./MissingCards.js";
import { ReportChapters } from "./ReportChapters.js";
import { ManaCurveChart } from "./ManaCurveChart.js";
import { LandMathChart } from "./LandMathChart.js";
import { ArchetypeBoard } from "./ArchetypeBoard.js";
import { CardList } from "./CardList.js";
import { CutList } from "./CutList.js";
import { BracketPanel } from "./BracketPanel.js";
import { LegalityPanel } from "./LegalityPanel.js";
import { ManaAvailability } from "./ManaAvailability.js";
import { REFERENCE_SURFACES, ReportShell } from "./ReportShell.js";
import { DeckGauges } from "./DeckGauges.js";
import { MemoryRouter } from "react-router";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { CHAPTERS } from "../lib/chapters.js";
import { HighSynergyCards } from "./HighSynergyCards.js";
import { BuildBenchmarks, demandSentence } from "./BuildBenchmarks.js";
import { SAMPLE } from "../fixtures.js";


// A CAVEAT THAT OUTLIVED THE DEFECT IT DESCRIBED. This panel printed "land-fetch ramp like Cultivate
// is not counted, so this reads low" -- deleted from the CLI when L4a made the figure a SIMULATION
// that models land-fetch ramp, and kept here, where it went on being read. Found in a live browser,
// not by a test. N6 is the same shape one panel over: two copies of a sentence, one of them updated.

// N6: ONE RENDERER ACROSS THE SURFACES. The range reads "55% – 62%" here exactly as it does in the
// CLI and in `CardList` -- this panel used to print its own compact "55–62%", which is how a
// measured zero came to read "1%" in one surface and "0%" in another.


/** A COLOUR ROW NAMES ITS UNIT, AND STATES ITS TURN ONCE.
 *
 *  It read `13 of 22 by turn 2` beside `1 card wants {U}{U} on turn 2` -- a bare pair of numbers
 *  with no noun, and a turn printed twice in one row. The phone judge's third run stopped there:
 *  *"the moment I hit `12 of 17 by turn 1` and realised the noun for 17 lives behind a closed grey
 *  line below all three rows"*. It was the only finding in that run that cost a whole section
 *  rather than seconds. `worst.turn` is the same value on both halves, so the unit is free.
 *
 *  THE UNIT ALONE WAS NOT ENOUGH. `13 of 22 sources` still left the DIRECTION open -- the fourth
 *  run: *"I can't tell whether 13 is what I have out of 22 wanted, or 13 wanted out of 22 I have."*
 *  A fraction cannot say which end is the deck; the verb the lands row already uses can. */
test("a colour row says which end of the fraction the deck is, and prints its turn once", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  const rows = screen.getAllByLabelText(/sources.*by turn/i);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    const text = (row.textContent ?? "").replace(/\s+/g, " ");
    expect(text, "the row never says which end of the fraction the deck is").toMatch(/\d+ sources, wants \d+/);
    expect(text.match(/turn/g) ?? [], `the turn is said twice in "${text}"`).toHaveLength(1);
  }
});

// A10's rule: a SPECIFIC primary measures itself, so the family share is the difference between
// "this deck is broken" and "five Daleks inside a creature deck".


test("ComboList shows the combo result", () => {
  render(<ComboList combos={SAMPLE.report.combos} />);
  expect(screen.getByText(/Infinite loop/)).toBeInTheDocument();
  expect(screen.getByText(/Phyrexian Altar/)).toBeInTheDocument();
});

test("ComboList section title uses the eyebrow convention, not a bold heading", () => {
  const { container } = render(<ComboList combos={[{ cards: ["A", "B"], result: "X" }]} />);
  const title = [...container.querySelectorAll("*")].find((el) => el.textContent === "Combos");
  expect(title?.className).toContain("eyebrow");
});

test("MissingCards lists unresolved names", () => {
  render(<MissingCards missing={SAMPLE.missing} />);
  expect(screen.getByText(/Beholder's Death Ray/)).toBeInTheDocument();
});

test("MissingCards renders nothing when empty", () => {
  const { container } = render(<MissingCards missing={[]} />);
  expect(container).toBeEmptyDOMElement();
});

// THE AVG CMC TILE IS GONE, and its test with it: a one-tile "grid" printed 2.9 while the Lands
// row four blocks above already read "avg mana value 2.92", where the figure is doing work (it is
// what sets the land target). One number, one place.
// MINOR 9 (whole-branch review, 2026-09-01): renamed. It says "the deck identity", but what it
// reads is RecognitionPanel's theme on Summary -- `DeckIdentity` is on the Engine sub-tab and this
// render never reaches it.

test("the report names the theme, and avg mana value only where it is load-bearing", () => {
  render(<MemoryRouter><ReportChapters data={SAMPLE} /></MemoryRouter>);
  // RecognitionPanel's theme, in chapter 1. `getAllBy` because in one scroll `DeckIdentity`
  // (chapter 2) prints the same theme -- which is the redundancy S7 makes visible on purpose.
  expect(screen.getAllByText("Tokens").length).toBeGreaterThan(0);
  // The tile is gone; the figure survives in the Lands row, where it is what sets the land target
  // (asserted in the deck-math tests, which are the ones carrying a `deckMath` fixture).
  expect(screen.queryByText("Avg CMC")).not.toBeInTheDocument();
});

test("ManaCurveChart labels the 7+ bucket and shows the peak count", () => {
  const curve = [
    { value: 0, count: 0 },
    { value: 1, count: 0 },
    { value: 2, count: 8 },
    { value: 3, count: 2 },
    { value: 4, count: 0 },
    { value: 5, count: 0 },
    { value: 6, count: 0 },
    { value: 7, count: 1 },
  ];
  render(<ManaCurveChart curve={curve} />);
  expect(screen.getByText("7+")).toBeInTheDocument();
  expect(screen.getByTestId("peak-label")).toHaveTextContent("8"); // peak bar's direct cap label
  expect(screen.getByTitle("8 cards at mana value 2")).toBeInTheDocument();
});

// Regression pin for the tick-suppression defect: every y-axis tick must carry real text, not be
// blanked out because it happens to duplicate a bar label or the peak's own callout number.
test("ManaCurveChart renders a non-empty label on every y-axis tick", () => {
  const curve = [
    { value: 0, count: 0 },
    { value: 1, count: 0 },
    { value: 2, count: 8 },
    { value: 3, count: 2 },
    { value: 4, count: 0 },
    { value: 5, count: 0 },
    { value: 6, count: 0 },
    { value: 7, count: 1 },
  ];
  const { container } = render(<ManaCurveChart curve={curve} />);
  const ticks = container.querySelectorAll("[data-testid='y-tick']");
  expect(ticks.length).toBeGreaterThan(0);
  ticks.forEach((tick) => {
    expect(tick.querySelector("text")?.textContent).not.toBe("");
  });
});

// Regression pin: the peak (count 8) sits exactly at the domain max on this 0-7 axis, which is
// the tightest case -- pre-fix, the y range ran to 0 so the peak callout's baseline landed AT the
// viewBox edge (y <= 0) and its ascenders were clipped off entirely, invisible in the browser even
// though the text node existed. TOP_PAD gives it room.
test("ManaCurveChart's peak callout and topmost y-tick clear the top edge of the viewBox", () => {
  const curve = [
    { value: 0, count: 0 },
    { value: 1, count: 0 },
    { value: 2, count: 8 },
    { value: 3, count: 2 },
    { value: 4, count: 0 },
    { value: 5, count: 0 },
    { value: 6, count: 0 },
    { value: 7, count: 1 },
  ];
  const { container } = render(<ManaCurveChart curve={curve} />);
  const peakY = Number(screen.getByTestId("peak-label").getAttribute("y"));
  expect(peakY).toBeGreaterThan(0);

  const tickYs = Array.from(container.querySelectorAll("[data-testid='y-tick'] text"))
    .map((el) => Number(el.getAttribute("y")));
  const topmostTickY = Math.min(...tickYs);
  // dominantBaseline="middle" centers the text on its y; half of the 7px font is the minimum gap
  // that keeps its top edge on-canvas.
  expect(topmostTickY).toBeGreaterThanOrEqual(3.5);
});

test("LandMathChart shows 8 bars (0-7 lands), labels the peak percentage, and calculates hypergeometric odds correctly", () => {
  render(<LandMathChart landCount={38} deckSize={99} />);
  // x-axis ticks 0..7 are each rendered exactly once
  for (let k = 0; k <= 7; k++) {
    expect(screen.getByText(String(k))).toBeInTheDocument();
  }
  // Peak at k=3 with ~29.57% → rounds to 30%
  expect(screen.getByTestId("peak-label")).toHaveTextContent("30%"); // peak bar's direct cap label
  expect(screen.getByTitle("30% chance of exactly 3 lands")).toBeInTheDocument(); // tooltip on peak bar
});

// The distribution chart is titled by its own <summary>, so it passes BarChart an EMPTY heading --
// which made it a role="img" with an empty accessible name, i.e. an unlabelled image to a screen
// reader. The heading is what a sighted reader sees and the name is a separate obligation.
test("LandMathChart's chart carries an accessible name of its own", () => {
  render(<LandMathChart landCount={38} deckSize={99} />);
  expect(screen.getByRole("img", { name: /lands in your opening seven/i })).toBeInTheDocument();
});

// The <desc> is generic code reading each caller's own sentences, so it is worth seeing it once on
// the PERCENTAGE chart as well as the count one (BarChart.test.tsx): a wording that reads correctly
// for "19 cards at mana value 3" can still read as nonsense for a probability.
test("LandMathChart's chart describes its shape in the caller's own units", () => {
  const { container } = render(<LandMathChart landCount={38} deckSize={99} />);
  expect(container.querySelector("svg > desc")!.textContent)
    .toBe("8 bars, 0 to 7. Highest: 30% chance of exactly 3 lands.");
});

// PAIRS ARE WHAT A GROUP CLAIMS; cards are only what it reaches. Both are printed, and the bar is
// sized by pairs — four groups reading "70 cards" with pair counts from 334 to 440 painted four
// identical full-width tracks over four different findings.
test("ArchetypeBoard counts pairs beside cards and previews a pair without a click", async () => {
  render(<ArchetypeBoard archetypes={SAMPLE.report.archetypes} />);
  expect(screen.getByText("Tokens Go Wide")).toBeInTheDocument();
  expect(screen.getByText(/1 pair · 2 cards/)).toBeInTheDocument();
  // A COLLAPSED ROW IS A LABEL AND A NUMBER, and a label is exactly what a reader cannot check:
  // the only thing that showed the review a mislabelled group was reading its pairs. Two are open.
  expect(screen.getByText(/Krenko, Mob Boss \+ Impact Tremors/)).toBeInTheDocument();
  await userEvent.click(screen.getByText("Tokens Go Wide"));
  expect(screen.getByText(/pays off tokens/)).toBeInTheDocument();
});

/** THE 2px THE WHOLE REPORT SCROLLED SIDEWAYS AT 390 (roadmap U1).
 *
 *  This row pinned TWO fixed columns -- the label at `w-40` (160px) and the figures at `w-44`
 *  (176px) -- either side of a 12px gap and a `flex-1` spacer, so it demanded 360px in a row that
 *  is 326px wide inside the panel's gutters at 390. Both were `shrink-0`, so the figures ran 34px
 *  past the row's own right edge and 2px past the VIEWPORT: `documentElement.scrollWidth` 392
 *  against a 390 client width, seven rows deep.
 *
 *  AND `w-44` WAS NARROWER THAN ITS OWN SENTENCE, which is why removing it also fixed the desktop:
 *  "233 pairs · 14 of 31 cards earn it" is 246px, so the figures wrapped inside their 176px box at
 *  EVERY width, and the row measured 32px at 1440 where it now measures 24px.
 *
 *  jsdom lays nothing out, so what is asserted is the CONTRACT the browser measurements produced --
 *  the same contract the mana rows one panel over already carry: the row wraps, and no cell in it
 *  is sized in rems against a container the class cannot see. The numbers came from the browser and
 *  are repeated in the commit. */
test("the group row wraps rather than pinning a figures column it cannot fit", () => {
  render(<ArchetypeBoard archetypes={SAMPLE.report.archetypes} />);
  const row = screen.getByText("Tokens Go Wide").closest("button")!;
  expect(row.className).toContain("flex-wrap");
  // The FIGURES cell is the one that overflowed, and it is the last child by construction: with no
  // width of its own, `ml-auto` is what still puts its right edge on the row's.
  const figures = row.lastElementChild!;
  expect(figures.textContent).toMatch(/pair/);
  expect(figures.className).toContain("ml-auto");
  expect(figures.className).not.toMatch(/\bw-\d/);
  // AND THE SPACER IS GONE: a `flex-1` filler is a third fixed thing to fit on a line that could
  // not fit two, and on a wrapped line it is a stray empty row.
  expect([...row.children].some((c) => c.className === "flex-1")).toBe(false);
});

// S13, and the point of the whole item: this board was the ONE coverage-limited surface with
// neither a worded caveat nor the hatch, while the `°` that was supposed to name it rendered on a
// chapter heading. The `°` is retired; these two pin what replaced it. The floor claim is not
// decoration -- `detectArchetypes` takes derived-only signals against a denominator of every
// nonland, so an unread card divides without ever signalling.
test("ArchetypeBoard says the strategies are a floor when the deck is partly read", () => {
  render(<ArchetypeBoard
    strategies={SAMPLE.report.strategies}
    archetypes={SAMPLE.report.archetypes}
    coverage={{ resolved: 100, derived: 52, underivedNames: ["Ash Barrens"], more: 0, caveat: "x" }}
  />);
  expect(screen.getByText(/cards of/)).toBeInTheDocument();
  expect(screen.getByText(/48 cards signal no strategy and still count in the share below/)).toBeInTheDocument();
  expect(screen.getByText(/is a floor/)).toBeInTheDocument();
});

test("ArchetypeBoard's floor caveat agrees with its own count", () => {
  // Written plural-only and caught on screen for the SECOND time in one session -- `coverage.ts`
  // had the identical defect an hour earlier ("1 card of 103 are not in the read corpus"). A deck
  // one card short of fully read is the common shape now that the corpus covers the rest.
  render(<ArchetypeBoard
    strategies={SAMPLE.report.strategies}
    archetypes={SAMPLE.report.archetypes}
    coverage={{ resolved: 103, derived: 102, underivedNames: ["Aboroth"], more: 0, caveat: "x" }}
  />);
  expect(screen.getByText(/1 card signals no strategy and still counts in the share below/)).toBeInTheDocument();
});

test("ArchetypeBoard says nothing about coverage on a fully-read deck", () => {
  // A caveat that is always present qualifies nothing -- the same rule the retired mark had, and
  // the reason `deckCoverage` returns undefined rather than a 100% object.
  render(<ArchetypeBoard strategies={SAMPLE.report.strategies} archetypes={SAMPLE.report.archetypes} />);
  expect(screen.queryByText(/is a floor/)).toBeNull();
});

/** S8 FOLD-IN. The pairs list printed "{pair.a} + {pair.b}" as raw text, so the one surface that
 *  names the evidence behind a group was the one surface you could not open a card from -- and
 *  therefore the one place a reader could not pin from either. */
test("the pairs behind a group name cards you can open", () => {
  render(
    <CardDrawerProvider graph={SAMPLE.graph}>
      <ArchetypeBoard archetypes={SAMPLE.report.archetypes} />
    </CardDrawerProvider>,
  );
  // `fixtures.ts:102` -- the one pair is a: "Krenko, Mob Boss", b: "Impact Tremors".
  expect(screen.getAllByRole("button", { name: "Krenko, Mob Boss" }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: "Impact Tremors" }).length).toBeGreaterThan(0);
});

test("ArchetypeBoard shows an empty-state message when there are no groups", () => {
  render(<ArchetypeBoard archetypes={[]} />);
  expect(screen.getByText(/No recognizable archetype patterns/)).toBeInTheDocument();
});

test("ArchetypeBoard shows the empty-state message when archetypes is undefined", () => {
  render(<ArchetypeBoard archetypes={undefined} />);
  expect(screen.getByText(/No recognizable archetype patterns/)).toBeInTheDocument();
});

/** T15: one panel, one identity claim. The board used to head its two lists "Strategies" and the
 *  group rows separately, and a reader met three answers to "what is this deck" on one screen --
 *  the chapter-1 theme, the widest Strategies bar, and the widest group bar. They now share a
 *  heading and the sentence that separates them from the theme. */
test("the board states that the theme leads and nothing under it competes", () => {
  render(<ArchetypeBoard
    strategies={[{ name: "tokens", label: "Tokens", confidence: 0.74 }] as any}
    archetypes={[]}
  />);
  // T1 removed the wrapping heading (it restated the chapter title) and moved the sentence out
  // from behind a disclosure -- which is stronger for T15, not weaker: the line a reader needs is
  // now the one they cannot miss.
  expect(screen.getByText(/neither is a ranking/)).toBeInTheDocument();
  expect(screen.getByText("Archetypes")).toBeInTheDocument();
  expect(screen.getByText("Tokens")).toBeInTheDocument();
  expect(screen.getByText("74%")).toBeInTheDocument();
});

/** T15: the card count was the whole defect. `cards.length` counts a card that joined by being
 *  PLAYED -- the matcher synthesises "any nonland is cast" and "any permanent enters" so a payoff
 *  has something to feed on -- and that is how 61 of 99 cards became `Spellslinger` on an
 *  Enchantress deck, at the top of the panel. The row says how many of them EARN it. */
test("a group row splits the members that earn it from the ones merely played", () => {
  const group = {
    category: "x",
    label: "Group X",
    cards: ["A", "B"],
    // A consumer always earns its place; a producer earns it only when the supply was authored
    // rather than synthesised, which `impliedProducer` marks.
    pairs: [{ a: "A", b: "B", reasons: [{ text: "r", consumer: "A", producer: "B", impliedProducer: true }] }],
  };
  render(<ArchetypeBoard strategies={[]} archetypes={[group] as any} nonlandNames={["A", "B"]} />);
  // Scoped through the size cell, because the matrix above renders the same label as a column head.
  const size = screen.getByText(/1 of 2 cards contribute/);
  expect(size).toBeInTheDocument();
  // NO BAR. A track scaled to the biggest group is a ranking, and it was read as one.
  expect(size.closest("button")!.querySelector(".rounded-full")).toBeNull();
});

test("an expanded synergy group caps its pair list", () => {
  const pairs = Array.from({ length: 12 }, (_, i) => ({ a: `A${i}`, b: `B${i}`, reasons: [{ text: "r" }] }));
  render(<ArchetypeBoard strategies={[]} archetypes={[{ category: "x", label: "Group X", cards: Array(12).fill("c"), pairs } as any]} />);
  fireEvent.click(screen.getByText("Group X"));
  expect(screen.getByText(/\+4 more/)).toBeInTheDocument();
});

/** THE PANEL TAKES THE WIDTH IT IS GIVEN (owner's call, 2026-09-03).
 *
 *  It was `max-w-[88rem]`, which made this one surface 448px narrower than every other one at 1920
 *  -- the report had two right edges -- and once the drawer docks, the reader watches the nav and
 *  the toolbar make room for it while the table underneath them does not. Owner: *"it is more
 *  cohesive to have table on full width and drawer moving everything to the left."*
 *
 *  MEASURED at 1920 after the change: table 32-1888 closed, the same right edge as the toolbar
 *  above it; 32-1568 with the drawer open, against a drawer left edge of 1624 -- overlap 0.
 *
 *  THE COST IS REAL AND IS KEPT IN THE COMPONENT: the card column runs to 1,384px at 1920, so the
 *  median row carries about 974px between its reason and its roles. The figures the old cap was
 *  derived from are still in `CardList`'s comment so a future round need not re-measure them. This
 *  asserts the DECISION, so undoing it is a deliberate act rather than a drift. */
test("the cards panel is not capped narrower than the page it sits on", () => {
  const { container } = render(<CardList cards={SAMPLE.report.cards} />);
  const panel = container.firstElementChild!;
  expect(panel.className).toContain("flex flex-col");
  expect(panel.className).not.toMatch(/max-w-\[\d+rem\]/);
  // The table is what fills it, and `w-full` is what makes "full width" mean the container.
  expect(container.querySelector("table")!.className).toContain("w-full");
});

/** R2, FIXED 2026-09-03: THE HEADER IS STICKY AT EVERY WIDTH, BECAUSE NOTHING SCROLLS AROUND IT.
 *
 *  It shipped `static sm:sticky` on 2026-09-02 as a stopgap. The table's wrapper was
 *  `overflow-x-auto` below `sm`, which makes it a SCROLL CONTAINER -- CSS forces `overflow-y` to
 *  `auto` alongside `overflow-x` -- and a sticky `<thead>` inside one resolves `top` against THAT
 *  container, not the viewport. The container's own top already sat at the page header's bottom, so
 *  `top: var(--report-header-h)` landed a SECOND time: container top 95 plus 95 put the thead at
 *  190, painting a 48px band across row 1, with 3 of 8 sample points down that row returning a `TH`
 *  from `elementFromPoint`. Turning the sticky off cost what S7 built it for -- on a phone the
 *  column labels scrolled away.
 *
 *  THE SCROLL CONTAINER IS WHAT LEFT. No `overflow-x` ancestor at any width, so `top` resolves
 *  against the viewport everywhere and the offset is applied once. Two things hold that: the table
 *  is `table-fixed` (so a nowrap cell cannot push its column past the container) and no `min-w-*`
 *  demands a width the container has not got.
 *
 *  A class assertion, because jsdom cannot measure a sticky offset. The pixels are in the roadmap. */
test("the column header is sticky at every width, with the offset applied once", () => {
  const { container } = render(<CardList cards={SAMPLE.report.cards} />);
  const thead = container.querySelector("thead")!;
  expect(thead.className).toContain("sticky");
  // THE WHOLE STACK ABOVE IT, and it grew on 2026-09-04 when the site header went sticky. A sticky
  // `top` is a viewport-absolute offset, so every bar pinned above this one has to be in the sum --
  // count only the report header and the column labels pin BEHIND the site header instead of under
  // it, which is the same class of defect as the hardcoded `top-[33px]` this test was written for.
  expect(thead.className)
    .toContain("top-[calc(var(--site-header-h,0px)+var(--report-header-h,0px))]");
  // The stopgap's own shape must not come back: a breakpoint on the sticky means a width where the
  // labels scroll away again.
  expect(thead.className).not.toContain("static");
  expect(thead.className).not.toContain("sm:sticky");
  // AND NOTHING AROUND IT MAY BE A SCROLLPORT, which is the whole mechanism: an `overflow-x` on any
  // ancestor puts the offset back on the container and the header back over row 1.
  const table = container.querySelector("table")!;
  expect(table.className).toContain("table-fixed");
  expect(table.className).not.toMatch(/min-w-/);
  for (let el = table.parentElement; el && el !== document.body; el = el.parentElement) {
    expect(el.className, el.className).not.toMatch(/overflow-x-(auto|scroll)/);
  }
});

test("CardList sorts by synergyRating descending, then name", () => {
  render(<CardList cards={SAMPLE.report.cards} />);
  // Row 0 is the header; data rows start at index 1.
  const rows = screen.getAllByRole("row").slice(1).map((el) => el.textContent ?? "");
  // Krenko: synergyRating 5. Impact Tremors: synergyRating 3.3.
  expect(rows[0]).toContain("Krenko, Mob Boss");
  expect(rows[1]).toContain("Impact Tremors");
});

/** The owner's "effect + cost": the two facts sit side by side and are never multiplied. Cost is
 *  deliberately absent from `synergyRating` — measured over the 71 decks, payoff cards skew
 *  expensive, so a cost term would discount payoffs by construction. */
test("Cards tab shows what a card costs and when you can cast it, beside the rating", () => {
  const cards = [{
    name: "Breach the Multiverse", synergyRating: 3.7, topPartners: [], manaCost: "{5}{B}{B}",
    manaValue: 7, castability: { turn: 7, castable: { low: 0.22, high: 0.4 }, mana: { low: 0.22, high: 0.4 } },
  }] as any;
  render(<CardList cards={cards} />);
  const row = screen.getAllByRole("row").find((r) => r.textContent?.includes("Breach"))!;
  // THE COST RENDERS TWICE, ONCE PER HALF OF THE BREAKPOINT (R2): as its own column from `sm`, and
  // inside the card cell below it, where that column is `hidden`. Exactly one is displayed at any
  // width; jsdom applies no media queries, so both are in the DOM here and each is asserted by name.
  const cost = row.querySelector('[data-cell="cost"]')!;
  const inline = row.querySelector('[data-cell="cost-inline"]')!;
  expect(cost.closest("td")!.className).toContain("hidden sm:table-cell");
  expect(inline.className).toContain("sm:hidden");
  // Pins the actual symbol set "{5}{B}{B}" decodes to, not merely "some mark rendered" -- a
  // dropped pip (e.g. only one black symbol) would still pass a bare non-empty check. Read off the
  // COST'S accessible name, which is one label since 2026-09-20: a cost is one fact, and labelling
  // both the wrapper and every symbol announced it twice.
  for (const where of [cost, inline]) {
    expect(where.querySelector('[role="img"]')!.getAttribute("aria-label"))
      .toBe("5 generic mana, one black mana, one black mana");
    expect([...where.querySelectorAll("i.ms")].map((i) => [...i.classList].find((c) => /^ms-(\d+|[wubrgc])$/.test(c))))
      .toEqual(["ms-5", "ms-b", "ms-b"]);
    expect(where.textContent).toContain("22% – 40% by T7");
  }
  expect(within(row).getByText("3.7")).toBeInTheDocument();
});

/** The precon persona listed "{3}{B}{B} and the rest of the cost symbols" among words it could not
 *  understand. Brace notation must not survive anywhere in this table -- widened past a single
 *  colour letter, since a generic-mana token like "{3}" carries no letter at all. */
/** S9. The ring is `--accent`: measured 4.9:1 against the page ground, over the 3:1 a graphical
 *  object owes -- --fill is 2.12:1 and must not carry it, which is the defect S17 had to fix. And
 *  the row says "new" in words, so the mark is never colour-only. */
test("a card this run added has its row ringed and marked new", () => {
  const name = SAMPLE.graph.nodes[0]!.label;
  const { unmount } = render(<CardDrawerProvider graph={SAMPLE.graph}><CardList cards={SAMPLE.report.cards} /></CardDrawerProvider>);
  expect(document.querySelector('tr[data-new="1"]')).toBeNull();
  unmount();
  render(<CardDrawerProvider graph={SAMPLE.graph} added={[name]}><CardList cards={SAMPLE.report.cards} /></CardDrawerProvider>);
  const row = document.querySelector('tr[data-new="1"]');
  expect(row).not.toBeNull();
  expect(row!.textContent).toContain(name);
  expect(row!.textContent).toContain("new");
});

test("the Cards table renders costs as symbols, not as brace notation", () => {
  const cards = [{
    name: "Breach the Multiverse", synergyRating: 3.7, topPartners: [], manaCost: "{3}{B}{B}",
  }] as any;
  render(<CardList cards={cards} />);
  expect(screen.queryByText(/\{[^}]+\}/)).toBeNull();
  expect(screen.getAllByRole("img", { name: /mana/ }).length).toBeGreaterThan(0);
});

/** A land has no cost row and a REFUSED cost (X, delve, convoke, a free cast) has no castability.
 *  Both must read as a blank: a 0% would tell the reader they cannot cast the card. */
test("a land or an unpriced cost renders a dash, never a zero", () => {
  const cards = [{ name: "Island", synergyRating: 0, topPartners: [] }] as any;
  render(<CardList cards={cards} />);
  const row = screen.getAllByRole("row").find((r) => r.textContent?.includes("Island"))!;
  // Both halves of the breakpoint pair refuse the same way -- a dash that only one of them printed
  // would be a 0% waiting to happen at the other width.
  for (const sel of ['[data-cell="cost"]', '[data-cell="cost-inline"]']) {
    expect(row.querySelector(sel)!.textContent).toContain("—");
  }
  expect(within(row).queryByText(/%/)).not.toBeInTheDocument();
});

test("Cards tab shows a card's functional role as a readable chip", () => {
  const cards = [{ name: "Sol Ring", roles: ["ramp"], synergyRating: 1.3, topPartners: [] }] as any;
  render(<CardList cards={cards} />);
  // Scope to the data row — with only one category present, "Ramp" also renders as
  // the filter chip, so an unscoped query would find two matches.
  const row = screen.getAllByRole("row").find((r) => r.textContent?.includes("Sol Ring"))!;
  // And twice WITHIN the row since R2: the roles column from `lg`, the same chips inside the card
  // cell below it. Both are asserted, because a chip missing from one is a role invisible at a width.
  expect(row.querySelector('[data-cell="roles"]')!.textContent).toContain("Ramp");
  expect(row.querySelector('[data-cell="roles-inline"]')!.textContent).toContain("Ramp");
});

test("Cards tab filters by functional category matching the Overview vocabulary", () => {
  const cards = [
    { name: "Sol Ring", roles: ["ramp"], synergyRating: 1.3, topPartners: [] },
    { name: "Chaos Warp", roles: ["targetedRemoval"], synergyRating: 0.6, topPartners: [] },
  ] as any;
  render(<CardList cards={cards} />);
  fireEvent.click(screen.getByRole("button", { name: "Removal" }));
  expect(screen.queryByText("Sol Ring")).not.toBeInTheDocument();
  expect(screen.getByText("Chaos Warp")).toBeInTheDocument();
});

test("Cards tab renders the new functional roles as readable chips", () => {
  const cards = [
    { name: "Preordain", roles: ["cardSelection"], synergyRating: 0.5, topPartners: [] },
    { name: "Counterspell", roles: ["stackInteraction"], synergyRating: 0, topPartners: [] },
    { name: "Lightning Bolt", roles: ["burn"], synergyRating: 0, topPartners: [] },
    { name: "Winter Orb", roles: ["stax"], synergyRating: 0, topPartners: [] },
  ] as any;
  render(<CardList cards={cards} />);
  // Each role is the only card in its category, so it renders both as the filter
  // chip and the row chip (see the single-category note above) — assert presence.
  expect(screen.getAllByText("Card selection").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Counterspells").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Burn & drain").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Stax").length).toBeGreaterThan(0);
});

test("Cards tab shows the top-partner reason under the card name", () => {
  const cards = [{ name: "Impact Tremors", roles: [], synergyRating: 3.0,
    topPartners: [{ name: "Krenko", reasons: [{ text: "Impact Tremors triggers on a creature entering; Krenko supplies it" }] }] }] as any;
  render(<CardList cards={cards} />);
  expect(screen.getByText(/triggers on a creature entering/)).toBeInTheDocument();
});


/** THE REPORT IS THE CHAPTERS; the three reference surfaces are routes off it (S7). What used to be
 *  five tabs is now one scroll, so the assertion that used to prove "switching reveals it" proves
 *  the opposite here: chapter 3's matrix is on screen WITH chapter 1's theme, and only a reference
 *  surface replaces them. */
test("the shell opens on the chapters and routes to the reference surfaces", async () => {
  render(<MemoryRouter><ReportShell data={SAMPLE} /></MemoryRouter>);
  expect(screen.getAllByText("Tokens").length).toBeGreaterThan(0); // chapter 1
  // Chapter 3's group row, named by its role so the assertion cannot pass on some other mention.
  expect(screen.getByRole("button", { name: /^Tokens Go Wide/ })).toBeInTheDocument();

  await userEvent.click(screen.getAllByRole("link", { name: /^Cards/ })[0]!);
  // Twice: the sticky header names the commander on every surface, and the table lists it.
  expect(screen.getAllByText("Krenko, Mob Boss").length).toBeGreaterThan(1); // CardList content
  expect(screen.queryByRole("button", { name: /^Tokens Go Wide/ })).toBeNull(); // the scroll is gone

  await userEvent.click(screen.getAllByRole("link", { name: /^Combos/ })[0]!);
  expect(screen.getByText(/Infinite loop/)).toBeInTheDocument(); // ComboList content

  await userEvent.click(screen.getByRole("link", { name: /Report/ }));
  expect(screen.getByRole("button", { name: /^Tokens Go Wide/ })).toBeInTheDocument();
});

// ART WARMS BEFORE THE GRAPH TAB IS EVER OPENED. `<GraphView>` is mounted by `active === "graph"`,
// so nothing requested an image until the user clicked Graph — and then ~95 discs queued at once,
// 75ms apart, while they waited. Every artCrop URL arrives with the analyze response and the user
// reads Overview for seconds first, so that time was being thrown away. Owner-reported: "why dont we
// start loading the images even before we land on the graph?".

test("ReportShell starts fetching card art on the chapters, before the graph is opened", async () => {
  const fetchSpy = vi.fn((_url: unknown) => Promise.reject(new Error("no network in this test")));
  vi.stubGlobal("fetch", fetchSpy);
  const withArt = {
    ...SAMPLE,
    graph: {
      ...SAMPLE.graph,
      nodes: SAMPLE.graph.nodes.map((n, i) =>
        (i === 0 ? { ...n, artCrop: "https://cards.scryfall.io/art_crop/a/b/c.jpg" } : n)),
    },
  };

  render(<MemoryRouter><ReportShell data={withArt} /></MemoryRouter>);

  // Never opened the graph route; the request is already out.
  expect(screen.queryByTestId("graph-canvas")).toBeNull();
  await vi.waitFor(() => {
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/art_crop/"))).toBe(true);
  });
});

// THE DISC AND THE CARD ARE DIFFERENT FILES. Card mode draws `/normal/`, the discs are
// `/art_crop/`, so warming only the discs left "zoom in and wait" exactly as it was — the board was
// warm and the card image had never been requested at all. Reported after the first attempt.
test("ReportTabs warms the full card images too, not just the discs", async () => {
  const fetchSpy = vi.fn((_url: unknown) => Promise.reject(new Error("no network in this test")));
  vi.stubGlobal("fetch", fetchSpy);
  const withArt = {
    ...SAMPLE,
    graph: {
      ...SAMPLE.graph,
      nodes: SAMPLE.graph.nodes.map((n, i) =>
        (i === 0 ? { ...n, artCrop: "https://cards.scryfall.io/art_crop/a/b/c.jpg" } : n)),
    },
  };

  render(<MemoryRouter><ReportShell data={withArt} /></MemoryRouter>);

  await vi.waitFor(() => {
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/normal/"))).toBe(true);
  }, { timeout: 3000 });
});


test("ReportShell shows the unresolved banner on every surface, chapters and reference alike", async () => {
  render(<MemoryRouter><ReportShell data={SAMPLE} /></MemoryRouter>);
  expect(screen.getByText(/Beholder's Death Ray/)).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole("link", { name: /^Cards/ })[0]!);
  expect(screen.getByText(/Beholder's Death Ray/)).toBeInTheDocument(); // still visible
});


test("ReportShell hides the unresolved banner when nothing is missing", () => {
  const noMissing = { ...SAMPLE, missing: [] };
  render(<MemoryRouter><ReportShell data={noMissing} /></MemoryRouter>);
  expect(screen.queryByText(/Unresolved/)).not.toBeInTheDocument();
});

test("CardList shows the per-card synergy rating", () => {
  render(<CardList cards={SAMPLE.report.cards} />);
  expect(screen.getByText("5.0")).toBeInTheDocument(); // Krenko's rating, one-decimal formatted
});

test("HighSynergyCards lists the top cards by rating, highest first", () => {
  render(<HighSynergyCards cards={SAMPLE.report.cards} />);
  const rows = screen.getAllByRole("listitem").map((el) => el.textContent ?? "");
  expect(rows[0]).toContain("Krenko, Mob Boss");
});

test("HighSynergyCards says when a rating rests on effects not read yet (issue #532)", () => {
  const cards = SAMPLE.report.cards.map((c, i) => (i === 0 ? { ...c, ratingProvisional: true as const } : c));
  render(<HighSynergyCards cards={cards} />);
  expect(screen.getAllByText("provisional: most of its effect not read yet")).toHaveLength(1);
});

test("HighSynergyCards shows the card's top reason text", () => {
  render(<HighSynergyCards cards={SAMPLE.report.cards} />);
  expect(screen.getAllByText("Krenko makes tokens; Impact Tremors pays off tokens.").length).toBeGreaterThan(0);
});

/** S18. The skeptic could not check a single synergy claim on nine screens: "the page asserts a
 *  relationship between two named cards and never prints either card's text, so a right answer and
 *  a wrong one look identical on my screen". The row's own title opened the drawer; the OTHER card
 *  in every sentence was dead text. Both names are live now. */
test("HighSynergyCards makes both cards in the sentence checkable", () => {
  render(
    <CardDrawerProvider graph={SAMPLE.graph}>
      <HighSynergyCards cards={SAMPLE.report.cards} />
    </CardDrawerProvider>,
  );
  // "Krenko makes tokens; Impact Tremors pays off tokens." -- the partner is a button, not prose.
  const partners = screen.getAllByRole("button", { name: "Impact Tremors" });
  expect(partners.length).toBeGreaterThan(0);
});

/** FIVE OF THE EXAMPLE DECK'S EIGHT reasons begin "When Mark of the Rani enters", and that is the
 *  commander's TOKEN -- not in the decklist, so `CardName` correctly refuses to link it and the
 *  page said nothing at all. The tuner and the skeptic both stopped on it, unable to tell whether
 *  it was a card, a token or a typo. */
test("a token named in a reason says it is one, and whose", () => {
  const graph = {
    ...SAMPLE.graph,
    nodes: [
      ...SAMPLE.graph.nodes,
      { id: "token:Goblin", label: "Goblin", isToken: true, kind: "token" },
    ],
    edges: [
      ...SAMPLE.graph.edges,
      { from: "Krenko, Mob Boss", to: "token:Goblin", weight: 1, tags: ["creates:creature"], reasonTexts: [] },
    ],
  } as never;
  render(
    <CardDrawerProvider graph={graph}>
      <HighSynergyCards cards={[{
        name: "Impact Tremors", isCommander: false, score: 1, synergyRating: 4, partnerCount: 3,
        topPartners: [{ name: "Krenko, Mob Boss", score: 1, reasons: [{ tag: "t", text: "When Goblin enters, Impact Tremors triggers" }] }],
      }] as never} />
    </CardDrawerProvider>,
  );
  expect(screen.getByText(/\(token from Krenko, Mob Boss\)/)).toBeInTheDocument();
});

/** A CREATE EDGE NAMES THE MAKER, not the first edge into the token: a landfall link credited
 *  Summon: Fat Chocobo's Bird to Flooded Strand (overview round 9). */
test("a token's maker is the card that creates it, even when another card links to it first", () => {
  const other = (SAMPLE.graph.nodes as { id: string; isToken?: boolean }[]).find((n) => !n.isToken && n.id !== "Krenko, Mob Boss")!.id;
  const graph = {
    ...SAMPLE.graph,
    nodes: [...SAMPLE.graph.nodes, { id: "token:Goblin", label: "Goblin", isToken: true, kind: "token" }],
    edges: [
      ...SAMPLE.graph.edges,
      { from: other, to: "token:Goblin", weight: 1, tags: ["enters:land"], reasonTexts: [] },
      { from: "Krenko, Mob Boss", to: "token:Goblin", weight: 1, tags: ["creates:creature"], reasonTexts: [] },
    ],
  } as never;
  render(
    <CardDrawerProvider graph={graph}>
      <HighSynergyCards cards={[{
        name: "Impact Tremors", isCommander: false, score: 1, synergyRating: 4, partnerCount: 3,
        topPartners: [{ name: "Krenko, Mob Boss", score: 1, reasons: [{ tag: "t", text: "When Goblin enters, Impact Tremors triggers" }] }],
      }] as never} />
    </CardDrawerProvider>,
  );
  expect(screen.getByText(/\(token from Krenko, Mob Boss\)/)).toBeInTheDocument();
});

/** THREE IDENTICAL SENTENCES, THREE DIFFERENT NUMBERS was the tuner's other stop. The score is not
 *  computed from the printed sentence -- it aggregates every partner -- and the row never said so.
 *  The count is NOT offered as the explanation, because it is not one: on the example deck those
 *  three cards carry 36, 38 and 38 partners and score 4.1 / 3.8 / 3.5, so the number does not order
 *  them either. It stops one sentence from reading as the whole case. */
// LESS IS MORE (owner, 2026-09-27): "one of N pairs behind this score" under every sentence went; the
// list is "Cards that carry it", six cards, one sentence each.
test("Cards that carry it names six cards, one sentence each, and no pair counts", () => {
  render(
    <CardDrawerProvider graph={SAMPLE.graph}>
      <HighSynergyCards cards={SAMPLE.report.cards} />
    </CardDrawerProvider>,
  );
  expect(screen.getByRole("heading", { name: "Cards that carry it" })).toBeInTheDocument();
  expect(screen.getAllByRole("listitem").length).toBeLessThanOrEqual(6);
  expect(screen.queryByText(/pairs behind this/)).toBeNull();
});

test("a card with a single connection claims no plurality", () => {
  render(
    <CardDrawerProvider graph={SAMPLE.graph}>
      <HighSynergyCards cards={[{
        name: "Solo Card", isCommander: false, score: 1, synergyRating: 4, partnerCount: 1,
        topPartners: [{ name: "Krenko, Mob Boss", score: 1, reasons: [{ tag: "t", text: "Krenko, Mob Boss feeds Solo Card" }] }],
      }] as never} />
    </CardDrawerProvider>,
  );
  expect(screen.queryByText(/connections behind this/)).toBeNull();
});

test("HighSynergyCards renders no reason line when the card has none", () => {
  render(
    <HighSynergyCards
      cards={[{ name: "Solo Card", isCommander: false, score: 1, synergyRating: 4, partnerCount: 0, topPartners: [] }]}
    />,
  );
  expect(screen.getByText("Solo Card")).toBeInTheDocument();
});

test("HighSynergyCards renders nothing when no card has a rating", () => {
  const { container } = render(<HighSynergyCards cards={[{ name: "X", isCommander: false, score: 0, partnerCount: 0, topPartners: [] }]} />);
  expect(container).toBeEmptyDOMElement();
});

test("HighSynergyCards marks the top-authority anchor and double-duty cards", () => {
  render(<HighSynergyCards cards={SAMPLE.report.cards} />);
  expect(screen.getAllByText(/key card/i).length).toBeGreaterThan(0); // ⚡ anchor marker
  expect(screen.getByText(/pulls double duty/i)).toBeInTheDocument(); // double-duty badge (Impact Tremors)
});


/** WHOSE ROW EACH TICK IS (owner ruling 2026-09-06: the report shows the rows). SAMPLE carries the
 *  spec's worked example -- Tokens 23% with Aristocrats 17% -- so every role dial names both rows
 *  under its bar and the source line says the blend and its weights. A player can put "Tokens 10 ·
 *  Aristocrats 14.5" next to EDHREC and check it, which is the whole point of showing them. */
test("each role tick names the theme rows it was blended from, and the source line says the weights", () => {
  render(<DeckGauges data={SAMPLE} />);
  expect(screen.getByText("Tokens 8 · Aristocrats 13")).toBeInTheDocument();        // Consistency, blends to the tick's 10
  expect(screen.getByText("Tokens 11 · Aristocrats 8.5")).toBeInTheDocument();      // Interaction
  expect(screen.getByText(/Ticks: what Tokens \(60%\) and Aristocrats \(40%\) decks run/)).toBeInTheDocument();
  expect(screen.queryByText(/Command Zone/)).toBeNull();
  // EDHREC is the sample the thesis was checked on, not the claim (owner, 2026-09-06): named once,
  // in the gloss only, never on a tick or the source line.
  const edhrec = screen.getAllByText(/EDHREC/);
  expect(edhrec).toHaveLength(1);
  expect(edhrec[0]!.closest("details")).not.toBeNull();
});

test("with no theme strong enough the ticks say they are the population's, and an old report keeps the old sentence", () => {
  const population = { consistency: 13, ramp: 11, interaction: 13, boardWipes: 2 };
  const fallback = { ...SAMPLE, report: { ...SAMPLE.report, template: { population, targets: population } } };
  const { unmount } = render(<DeckGauges data={fallback} />);
  expect(screen.getAllByText("Archetype median 13").length).toBe(2); // Consistency and Interaction share it
  expect(screen.getByText(/Ticks: what the median Commander deck runs/)).toBeInTheDocument();
  unmount();
  const { template: _t, ...withoutTemplate } = SAMPLE.report;
  render(<DeckGauges data={{ ...SAMPLE, report: withoutTemplate }} />);
  expect(screen.getByText(/Command Zone template/)).toBeInTheDocument();
});

/** THE SHARE AND THE FLOOR, NOT A VERDICT (UX sweep 2026-09-06, D4). "Enchantress" as the headline,
 *  "Enchantress 25%" on the bar, and "no archetype read strongly enough" under the ticks were three
 *  readings of 0.249 against a 0.25 floor. The line now prints both numbers. */
// ONE LINE SINCE 2026-09-27 (owner: "less is more"): the line says what a tick is, and no longer
// argues why the theme did or did not earn targets of its own.
test("under the floor, the tick line says the ticks are the median deck's, in one line", () => {
  const population = { consistency: 13, ramp: 11, interaction: 13, boardWipes: 2 };
  const data = { ...SAMPLE, report: { ...SAMPLE.report,
    strategies: [{ name: "enchantress" as const, label: "Enchantress", confidence: 0.249 }],
    template: { population, targets: population, leadFloor: 0.25 } } };
  render(<DeckGauges data={data} />);
  expect(screen.getByText(/Ticks: what the median Commander deck runs/)).toBeInTheDocument();
  expect(screen.queryByText(/Being over is fine|Going over a tick is fine/)).toBeNull();
});

/** AND THE BAR NEVER ROUNDS UP OVER IT: 0.249 printed "25%" beside that note. */
test("an archetype bar floors its percentage", () => {
  render(<ArchetypeBoard strategies={[{ name: "enchantress", label: "Enchantress", confidence: 0.249 }]} archetypes={SAMPLE.report.archetypes} />);
  expect(screen.getByText("24%")).toBeInTheDocument();
});

/** THE ENGINE'S FALLBACK IS MARKED WHEREVER IT IS PRINTED (skeptic, UX sweep 2026-09-06). The card
 *  page said "engine did not read what it does" under a "<card> triggers" row; the report printed
 *  the same sentence as a claim -- and the deck's 5.0 anchor was one of them. */
test("a reason that ends in \"triggers\" carries the unread mark; a real claim does not", () => {
  const { unmount } = render(<ReasonText text="When Arcane Signet is cast, Displacer Kitten triggers" />);
  expect(screen.getByText(/what it does isn't read yet/)).toBeInTheDocument();
  unmount();
  render(<ReasonText text="When Arcane Signet is cast, Shark Typhoon makes a token" />);
  expect(screen.queryByText(/what it does isn't read yet/)).toBeNull();
});

/** THE TWO SCORES ARE THE DIALS NOW (roadmap S15). `HeadlineScores`' tiles printed the same two
 *  figures directly beneath them — a third copy counting the sticky header — so the tiles retired
 *  and their `Explain` glosses, which were the only place either score said what it measures,
 *  moved onto the dials. These are the tile's assertions, re-aimed at where the words live. */
test("the score dials name each score, its value and its band", () => {
  render(<DeckGauges data={SAMPLE} />);
  expect(screen.getByText("Synergy")).toBeInTheDocument();
  expect(screen.getByText("Build")).toBeInTheDocument();
  // `getAllBy` on the figures: SAMPLE's Lands bullet also reads 4.0, and this test is about the
  // dial naming its score, not about which other row happens to share a number.
  expect(screen.getAllByText("4.0").length).toBeGreaterThan(0);   // synergyOverall
  expect(screen.getAllByText("3.7").length).toBeGreaterThan(0);   // buildScore
  // The dial prints its band in the gauge's own lower case ("tuned"), where the retired tile
  // capitalised it -- the word is the same one `scoreBand` gives both.
  expect(screen.getAllByText(/tuned|focused/i).length).toBeGreaterThan(0);
  // Breadth and anchor are the two inputs, printed as their own bullets under the Synergy dial.
  expect(screen.getAllByText(/focus/i).length).toBeGreaterThan(0);
});

// THE BANDS WERE IN A `title` TOOLTIP, which does not exist on touch and is undiscoverable with a
// mouse — on the page's own lead figure. They are printed now, one click down, beside a gloss that
// says what the two halves of SYNERGY actually measure and which card the anchor is.

// THE BANDS WERE IN A `title` TOOLTIP, which does not exist on touch and is undiscoverable with a
// mouse — on the page's own lead figure. They are printed now, one click down, beside a gloss that
// says what the two halves of SYNERGY actually measure and which card the anchor is.
test("each dial explains its scale, and Synergy names the anchor card", async () => {
  const user = userEvent.setup();
  render(<DeckGauges data={SAMPLE} />);
  const gloss = screen.getAllByText("what this measures");
  expect(gloss).toHaveLength(2); // Synergy and Build each say what they mean
  await user.click(gloss[0]!);
  expect(screen.getAllByText(/0–1.5 unfocused/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Krenko, Mob Boss/)).toBeInTheDocument(); // the deck's best-fed card
});

/** A `<details>` INSIDE A `<button>` IS NOT OPERABLE — nested interactive content, and the dial is
 *  a button whenever it has somewhere to open. The gloss is a SIBLING of the dial, never a child,
 *  and this is what stops a later refactor folding it back inside. */
test("the dial's explanation is not nested inside the dial's own button", () => {
  render(<DeckGauges data={SAMPLE} />);
  for (const summary of screen.getAllByText("what this measures")) {
    expect(summary.closest("button")).toBeNull();
  }
});

// PINNED, BYTE FOR BYTE (MINOR G, whole-branch review, 2026-09-01). `BANDS` moved from a literal
// string to one built from `SCORE_BREAKS` and `scoreBand`'s own labels -- this proves the rendered
// text a reader sees did not change even though the source moved from a transcription to a
// derivation.

// PINNED, BYTE FOR BYTE (MINOR G, whole-branch review, 2026-09-01; moved with `bandLegend` into
// `lib/score-band.ts` by S15). `BANDS` moved from a literal string to one built from `SCORE_BREAKS`
// and `scoreBand`'s own labels -- this proves the rendered text a reader sees did not change even
// though the source moved from a transcription to a derivation, and then moved file.
/** AND IT IS ON THE SCREEN, not folded behind the disclosure.
 *
 *  The pinned test below proves the WORDS; this proves WHERE. The phone judge's re-run
 *  (2026-09-03) put the phone down at "Breadth 2.3 developing next to Anchor 4.3 tuned" and named
 *  the fix as *"knowing, without tapping, that Breadth and Anchor mean what that paragraph says"*.
 *  The round before had already made the disclosure a 44px target and the same judge confirmed that
 *  bought the miss and not the find -- so the scale is unfolded and, crucially, is NOT ALSO left
 *  inside the disclosure: an always-visible line reading word-for-word the same as a disclosure's
 *  opening is a defect this report has already filed against itself. */
test("the band scale is visible under each dial and is not repeated inside the disclosure", () => {
  const { container } = render(<DeckGauges data={SAMPLE} />);
  // BY CONTAINER, NOT `getByText`. Each band is its own `whitespace-nowrap` span now, so no single
  // element holds the whole sentence -- the DOM-text-concatenation trap this suite has hit before.
  // Synergy's scale and Build's own (wording review 2026-09-25: Build's bands are its own words).
  const strips = [...container.querySelectorAll("p")].filter((el) => /unfocused|far off/.test(el.textContent ?? ""));
  // One per lead dial -- Synergy and Build each carry the scale their own needle is read against.
  expect(strips).toHaveLength(2);
  for (const strip of strips) {
    expect(strip.closest("details"), "the scale is still folded away").toBeNull();
  }
  for (const details of container.querySelectorAll("details")) {
    expect(details.textContent, "the scale is said twice").not.toMatch(/unfocused ·|far off ·/);
  }
});

test("the printed band scale is exactly the four SCORE_BREAKS bands, unchanged by the derivation", () => {
  const { container } = render(<DeckGauges data={SAMPLE} />);
  // STILL BYTE FOR BYTE, read off the element instead of through a text matcher: the strip is one
  // span per band now (so a band cannot wrap in half), which means no single element's text is the
  // whole sentence. Whitespace is normalised the way `getByText` would have; the words, the
  // ranges, the order and the separators are compared exactly.
  const printed = [...container.querySelectorAll("p")]
    .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((text) => /^0–1\.5 /.test(text));
  // One scale per dial, each in its own words: Build is not called "tuned", which a player reads as
  // power level beside the bracket (wording review 2026-09-25).
  expect(printed).toEqual([
    "0–1.5 unfocused · 1.5–3 developing · 3–4 focused · 4–5 tight",
    "0–1.5 far off · 1.5–3 short · 3–4 close · 4–5 on target",
  ]);
});

// TASK 5 (2026-09-01): the parent's own count-against-target row (CONSISTENCY 15/14, RAMP 17/10,
// INTERACTION 19/10, BOARD WIPES 1/1) moved to Recognition -- it is what the deck IS, and printing
// it here too put the same four numbers on one screen twice. `RecognitionPanel.test.tsx` covers
// the parent counts now; what is left to prove here is the LEAF math, which never carried a ratio
// of its own even before this task.
test("BuildBenchmarks: a leaf's facets are said beside its count and never added to it", () => {
  const cats = SAMPLE.report.buildCategories!.map((c) =>
    c.category === "draw" ? { ...c, count: 14, facets: { engines: 5, unlabelled: 3 } } : c);
  render(<BuildBenchmarks categories={cats} parents={SAMPLE.report.buildParents} />);
  const draw = screen.getByText(/^Draw$/).closest("li")!;
  expect(draw.textContent).toMatch(/5 engines · 3 unlabelled/);
  // The count keeps its column: facet text precedes it, never trails it.
  expect(draw.textContent).toMatch(/5 engines · 3 unlabelled14 · \d+%$/);
  expect(draw.getAttribute("aria-label")).toMatch(/5 engines · 3 unlabelled$/);
});

test("BuildBenchmarks: a leaf shows count and share, never a ratio", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} parents={SAMPLE.report.buildParents} />);
  // Tutors is a Consistency LEAF: it renders (owner's ruling: every leaf shows, including a zero),
  // but never as a "x/y" ratio -- only its count and share of Consistency's own total.
  expect(screen.getByText(/^Tutors$/)).toBeInTheDocument();
  const tutors = screen.getByText(/^Tutors$/).closest("li")!;
  expect(tutors.textContent).not.toMatch(/\d+\s*\/\s*\d+/);
  expect(tutors.textContent).toMatch(/0\s*·\s*0%/);
});

// FIX F4 (controller review, 2026-08-21, found live on `burakos-crashing-the-party`): Interaction's
// real numbers were Removal 5 + Stack interaction 2 + Graveyard hate 1 + Protection 0 = 9 leaf
// mentions, but the parent's own UNION was 8 (one card fills two leaves) -- dividing each leaf's
// share by the union read 75+13+13+13 = 114%, which reads as a broken number on a panel whose whole
// argument is that its figures mean what they say.
const OVERLAP_CATEGORIES = [
  { category: "draw", count: 6, target: 0 },
  { category: "cardSelection", count: 3, target: 0 },
] as unknown as typeof SAMPLE.report.buildCategories;
const OVERLAP_PARENTS = [
  // 6 + 3 = 9 leaf mentions; ONE card fills both leaves, so the parent's own union is only 8.
  { name: "Consistency", count: 8, target: 10, leaves: ["draw", "cardSelection"] },
] as unknown as typeof SAMPLE.report.buildParents;

test("leaf shares total 100% even when a card fills two leaves, and the header says why", () => {
  render(<BuildBenchmarks categories={OVERLAP_CATEGORIES} parents={OVERLAP_PARENTS} />);
  // Divided by the LEAF SUM (9), never the parent's union (8): 6/9 = 67%, 3/9 = 33%. These total
  // 100% by construction -- 6/8 + 3/8 would have been 112%.
  expect(screen.getByLabelText(/^Draw 6, 67% of Consistency/)).toBeInTheDocument();
  expect(screen.getByLabelText(/^Card selection 3, 33% of Consistency/)).toBeInTheDocument();
  // C1 (whole-branch review, 2026-09-01), RESTORED after fix round 2 deleted it with the parent
  // row: the denominator those shares are OF has to be on the same screen as the shares. It is 9,
  // and Recognition's "Consistency 8" is the UNION -- so without this line a reader who does the
  // only arithmetic available to them gets 8 x 67% = 5.4 for a leaf that holds 6 cards. The
  // overlap is a real fact about the deck and is stated, not left to be inferred.
  const header = screen.getByTestId("role-group-total-Consistency");
  expect(header).toHaveTextContent("9 counted across 8 cards");
  expect(header).toHaveTextContent(/some fill two of these roles/);
});

// The overlap clause is a disclosure, not decoration: with no overlap there is nothing to disclose
// and the header states the whole and stops.
test("a parent whose leaves do not overlap states the whole and nothing else", () => {
  const parents = [
    { name: "Consistency", count: 9, target: 10, leaves: ["draw", "cardSelection"] },
  ] as unknown as typeof SAMPLE.report.buildParents;
  render(<BuildBenchmarks categories={OVERLAP_CATEGORIES} parents={parents} />);
  const header = screen.getByTestId("role-group-total-Consistency");
  expect(header).toHaveTextContent("9 cards");
  expect(header).not.toHaveTextContent(/fill two/);
});

/** MINOR 7 (whole-branch review, 2026-09-01). `hasBenchmarkContent` tested `scoredParents.length >
 *  0`, but a scored parent draws nothing at all unless it has more than one leaf -- so a
 *  `buildParents` of only single-leaf parents produced the heading over an empty list, the exact
 *  broken-heading shape the guard exists to prevent. */
test("single-leaf parents alone render no heading, because they render no rows", () => {
  const singles = [
    { name: "Ramp", count: 8, target: 10, leaves: ["ramp"] },
    { name: "Board wipes", count: 1, target: 3, leaves: ["boardWipe"] },
  ] as unknown as typeof SAMPLE.report.buildParents;
  const { container } = render(
    <BuildBenchmarks categories={SCRAMBLED_CATEGORIES} parents={singles} />,
  );
  expect(container).toBeEmptyDOMElement();
});

// FIX F2 (controller review, 2026-08-21): `build.ts`'s own scoring loop skips a parent whose
// target is <= 0 outright ("neutral, unscored" -- `if (p.target <= 0) continue;`), and
// `scoredParents` (`BuildBenchmarks.tsx`) mirrors that skip for which leaves render at all -- a
// leaf under an unscored parent stays hidden, the same "not scored, so not shown" treatment a
// zero-target ungrouped leaf already gets. BOTH parents here are MULTI-leaf (task 5 fix round 1):
// the original version of this test used two single-leaf fixtures, which render no leaf row
// either way post-task-5 and so no longer exercise the gate at all, only the fixture's shape.
const ZERO_TARGET_MULTI_LEAF_CATEGORIES = [
  { category: "draw", count: 6, target: 0 },
  { category: "cardSelection", count: 2, target: 0 },
  { category: "targetedRemoval", count: 3, target: 0 },
  { category: "stackInteraction", count: 1, target: 0 },
] as unknown as typeof SAMPLE.report.buildCategories;
const ZERO_TARGET_MULTI_LEAF_PARENTS = [
  { name: "Consistency", count: 8, target: 10, leaves: ["draw", "cardSelection"] },
  // count > 0 against target 0 is deliberate, mirroring the original fixture's own reasoning: a
  // parent can be unscored while its cards still exist in the deck.
  { name: "Interaction", count: 4, target: 0, leaves: ["targetedRemoval", "stackInteraction"] },
] as unknown as typeof SAMPLE.report.buildParents;

test("a zero-target parent's leaves stay hidden, while a scored sibling's leaves render", () => {
  const { container } = render(<BuildBenchmarks categories={ZERO_TARGET_MULTI_LEAF_CATEGORIES} parents={ZERO_TARGET_MULTI_LEAF_PARENTS} />);
  // The scored parent's leaves render normally.
  expect(screen.getByText(/^Draw$/)).toBeInTheDocument();
  expect(screen.getByText(/^Card selection$/)).toBeInTheDocument();
  // The zero-target parent's leaves are entirely absent -- not present with a broken/zero row,
  // absent outright.
  expect(screen.queryByText(/^Removal$/)).not.toBeInTheDocument();
  expect(screen.queryByText(/^Counterspells$/)).not.toBeInTheDocument();
  // RESTORED (IMPORTANT 6, whole-branch review, 2026-09-01), deleted as collateral when the parent
  // bar went. A zero target is what produces the nonsense widths -- 2/0 is Infinity, 0/0 is NaN --
  // and BOTH filters that stand between a zero target and a rendered width (`scoredParents` here,
  // `ungrouped` for a parentless leaf) exist to stop it. One assertion covers whichever of them
  // someone loosens.
  expect(container.innerHTML).not.toMatch(/NaN/);
  expect(container.innerHTML).not.toMatch(/Infinity/);
});

// A scrambled category order (not the array order BUILD_PARENTS.leaves lists, not the order the
// fixture above happens to use) so the test can only pass if the component actually GROUPS rather
// than coincidentally rendering in input order. `parents` is authored by hand here, mirroring what
// `computeBuild` would derive from these same leaf counts (unions, no overlap in this fixture).
const SCRAMBLED_CATEGORIES = [
  { category: "boardWipe", count: 1, target: 0 },
  { category: "cardSelection", count: 2, target: 0 },
  { category: "draw", count: 6, target: 0 },
  { category: "ramp", count: 8, target: 0 },
  { category: "targetedRemoval", count: 3, target: 0 },
  { category: "graveyardHate", count: 1, target: 0 },
] as unknown as typeof SAMPLE.report.buildCategories;
const SCRAMBLED_PARENTS = [
  { name: "Consistency", count: 8, target: 10, leaves: ["draw", "cardSelection", "tutor"] }, // 6+2+0
  { name: "Ramp", count: 8, target: 10, leaves: ["ramp"] },
  { name: "Interaction", count: 4, target: 10, leaves: ["targetedRemoval", "stackInteraction", "graveyardHate", "protection"] }, // 3+0+1+0
  { name: "Board wipes", count: 1, target: 3, leaves: ["boardWipe"] },
] as unknown as typeof SAMPLE.report.buildParents;

test("every leaf still renders grouped under its own parent, in the parent's own order", () => {
  render(<BuildBenchmarks categories={SCRAMBLED_CATEGORIES} parents={SCRAMBLED_PARENTS} />);
  // DOM order follows BUILD_PARENTS, never the input array: Consistency's own leaves (draw, card
  // selection, tutor) before Interaction's (removal, stack interaction, graveyard hate,
  // protection) -- which the scrambled input above does not hold in either order. Ramp and Board
  // wipes are single-leaf parents (task 5): their own row moved to Recognition, and their one leaf
  // would just repeat that same count, so neither renders anything here.
  const leaves = screen.getAllByRole("listitem").map((li) => li.getAttribute("aria-label"));
  expect(leaves).toEqual([
    expect.stringMatching(/^Draw 6, 75% of Consistency/),
    expect.stringMatching(/^Card selection 2, 25% of Consistency/),
    expect.stringMatching(/^Tutors 0, 0% of Consistency/), // absent from SCRAMBLED_CATEGORIES entirely -- still renders, at 0
    expect.stringMatching(/^Removal 3, 75% of Interaction/),
    expect.stringMatching(/^Counterspells 0, 0% of Interaction/),
    expect.stringMatching(/^Graveyard hate 1, 25% of Interaction/),
    expect.stringMatching(/^Protection 0, 0% of Interaction/),
  ]);
});

/** IMPORTANT 6 (whole-branch review, 2026-09-01). `bar()` and `TARGET_MARK` render on no screen
 *  today and the test that pinned their geometry was deleted outright with the parent row. The
 *  controller's ruling was to KEEP the code and RESTORE the test: `ungrouped` is empty because of
 *  DATA -- `build.ts`'s `BASE_TARGETS` gives burn and stax a target of 0 -- and one target change
 *  puts this shape back on the screen with nothing measuring it. The fixture below is what a
 *  nonzero target for an unparented category looks like.
 *
 *  A category is ungrouped when no `buildParents` entry names it as a leaf, so passing no parents
 *  at all is the smallest fixture that produces two of them. */
const UNGROUPED_CATEGORIES = [
  { category: "ramp", count: 6, target: 10 },   // under: 6/10 of a mark at 70% = 42%
  { category: "draw", count: 14, target: 10 },  // over: 14/10 x 70% = 98%, clamped only at 100%
] as unknown as typeof SAMPLE.report.buildCategories;

test("a benchmark bar is read against a fixed target mark, so over-target does not paint as full", () => {
  const { container } = render(<BuildBenchmarks categories={UNGROUPED_CATEGORIES} />);
  // The FILL specifically -- matching "any span with a width" would read the track or the mark.
  const width = (label: RegExp): string =>
    (screen.getByLabelText(label).querySelector('[class*="bg-(--success)"], [class*="bg-(--warning)"]') as HTMLElement)
      .style.width;
  // The target sits at 70% of every track. Ramp 6/10 stops short of it, Draw 14/10 runs past it --
  // the old `min(1, count/target)` clamp painted BOTH at the same full width, which is what made
  // five of six rows carry no information at all.
  expect(width(/^Ramp 6 of 10/i)).toBe("42%");
  expect(width(/^Draw 14 of 10/i)).toBe("98%");
  // One mark per bar, all at the same x: that shared landmark is what makes rows with different
  // targets comparable at a glance.
  expect(container.querySelectorAll('span[style*="left: 70%"]').length).toBe(UNGROUPED_CATEGORIES!.length);
});

test("an ungrouped bar flags under target and ticks on target", () => {
  render(<BuildBenchmarks categories={UNGROUPED_CATEGORIES} />);
  expect(screen.getByLabelText(/^Ramp 6 of 10, under target/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/^Draw 14 of 10, on target/i)).toBeInTheDocument();
});

// TASK 5 (2026-09-01): every test that lived in this block asserted the Interaction row's
// coverage-dock note or its "colour pool unweighted" caveat -- both suffixes on the PARENT row
// this task removes (that row carried them, and only that row). The dock note has no other home
// on this panel; it was collateral to the row it was attached to, not a separate feature. Deleted
// with the row rather than kept as tests of a suffix nothing renders any more.
const DECK_MATH = {
  topdeck: [],
  turn: 5,
  seen: 12,
  library: 99,
  answers: [
    { class: "creature", count: 4, exiling: 1, recurring: 0, fromCommandZone: false, available: 0.409, required: 6 },
    { class: "artifact", count: 0, exiling: 0, recurring: 0, fromCommandZone: false, available: 0, required: 6 },
    { class: "graveyard", count: 1, exiling: 1, recurring: 0, fromCommandZone: true, available: 1, required: 0 },
  ],
  turnSource: "clock" as const,
  clock: { turn: 8, powerAtFive: 6.4 },
  wincons: {
    classes: [
      { class: "go-wide", count: 12, share: 0.6, cards: Array.from({ length: 12 }, (_, i) => `Token Maker ${i + 1}`), payoffs: ["Intangible Virtue"] },
      { class: "burn", count: 8, share: 0.4, cards: ["Impact Tremors", "Lightning Bolt"] },
    ],
    focus: 0.52,
    primary: "go-wide",
  },
  lands: { actual: 37, target: 34, targetSource: "derived" as const, rawTarget: 34, archetypeDelta: 0, avgManaValue: 2.7, rampPlusDraw: 12, fastMana: 2, mdfc: 0 },
  castability: {
    cards: [
      { name: "Ulamog", turn: 10, castable: { low: 0.03, high: 0.11 }, mana: { low: 0.03, high: 0.11 } },
      { name: "Damnation", turn: 4, castable: { low: 0.61, high: 0.78 }, mana: { low: 0.7, high: 0.9 } },
    ],
    refused: 3,
    biases: "Ignores ramp, so it under-states; ignores tapped lands and colour coupling, so it over-states.",
  },
  colors: [
    { color: "B", supplied: 18, worst: { pips: 2, turn: 3, required: 21, requiredRaw: 33, cards: 12, available: 13 } },
    { color: "U", supplied: 30 },
  ],
  demand: [
    { key: "enters:any", consumers: 20, suppliers: 84, available: 1, fromCommandZone: false },
    { key: "dies:any", consumers: 2, suppliers: 2, available: 0.227, fromCommandZone: false },
    { key: "attacks:any", consumers: 3, suppliers: 0, available: null, fromCommandZone: false },
  ],
};

/** S9. The castability rows are already one per card, so this is the same accent outline the Cards
 *  table carries. `DECK_MATH.castability.cards` holds Ulamog and Damnation. */
test("a card this run added has its castability row ringed and says so", () => {
  render(
    <CardDrawerProvider graph={SAMPLE.graph} added={["Ulamog"]}>
      <BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />
    </CardDrawerProvider>,
  );
  const row = document.querySelector('li[data-new="1"]')!;
  expect(row).not.toBeNull();
  // The row already carries a full aria-label, so "new" joins that sentence.
  expect(row.getAttribute("aria-label")).toContain("Ulamog");
  expect(row.getAttribute("aria-label")).toContain(", new");
});

test("deck-math blocks are grouped under the question they answer, worst section first", () => {
  // Scoped to `<section> > h3` -- I3 (whole-branch review, 2026-09-01) promoted these from h4 so
  // they stop skipping a level under the sub-tab's own h2 and stop inverting against the h3 panels
  // beside them. T6's parent-category group headers are the h4s now, one rank below.
  const headings = (): string[] =>
    [...document.querySelectorAll("section > h3")].map((h) => h.textContent ?? "");

  // Both sections carry a flag on this fixture (colour B is short, artifact has no answers), so the
  // fixed order stands and "cast" leads.
  const { unmount } = render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(headings()).toEqual([
    "Can you cast your cards",
    "Can you deal with theirs",
    "How you win",
    "What your cards are waiting for",
  ]);
  unmount();

  // Take the mana problems away and the answers section leads instead: the section order is the
  // panel's answer to "what is wrong with THIS deck", while the headings themselves never change.
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      deckMath={{
        ...DECK_MATH,
        colors: [{ color: "U", supplied: 30 }],
        lands: { ...DECK_MATH.lands, target: 36 },
      }}
    />,
  );
  expect(headings()[0]).toBe("Can you deal with theirs");
});

test("a section whose blocks are all absent renders no heading at all", () => {
  // A mill deck can have no win plans and no clock -- an empty section heading is a promise the
  // panel does not keep.
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      deckMath={{ ...DECK_MATH, clock: undefined as never, wincons: { classes: [], focus: 0 } }}
    />,
  );
  expect(screen.queryByText("How you win")).not.toBeInTheDocument();
  expect(screen.getByText("Can you deal with theirs")).toBeInTheDocument();
});

/** THE FOUR GROUPS ARE ADDRESSABLE, BY ID AND NOT BY TITLE. `DeckMathRows` already grouped itself
 *  into four named sections; the sub-tabs need to route them to three different places. Selecting
 *  on the visible title would mean a copy edit silently unwires a tab -- the same
 *  rename-breaks-the-wiring defect `coverageWeighted` exists to avoid. */
test("BuildBenchmarks renders only the deck-math sections it is asked for", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories}
    deckMath={DECK_MATH} sections={["cast"]} />);
  expect(screen.getByText("Can you cast your cards")).toBeInTheDocument();
  expect(screen.queryByText("Can you deal with theirs")).toBeNull();
  expect(screen.queryByText("How you win")).toBeNull();
});

test("BuildBenchmarks renders every deck-math section when none is specified", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  for (const title of ["Can you cast your cards", "Can you deal with theirs", "How you win"]) {
    expect(screen.getByText(title)).toBeInTheDocument();
  }
});

test("BuildBenchmarks shows answer coverage, including the classes the deck cannot answer", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.getByText(/answers by turn 5/i)).toBeInTheDocument();
  // A class with zero answers is the finding, so it must be a visible row rather than an omission.
  expect(screen.getByLabelText(/artifact, no answers/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/creature, 4 cards, in hand by turn 5 in 41% of games, 1 of them exile/i)).toBeInTheDocument();
  // A commander answer is available every game, and says why rather than just reading 100%.
  expect(screen.getByLabelText(/graveyard, 1 card, your commander, so every game, none keep working/i)).toBeInTheDocument();
});

test("an answer row says how many of its answers exile, and flags a graveyard row that never recurs", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  // 4 creature answers, 1 of which exiles -- the other 3 are undone by a reanimator.
  expect(screen.getByLabelText(/creature, 4 cards.*1 of them exile/i)).toBeInTheDocument();
  // The graveyard row's finding is the ZERO: it has hate, and none of it answers an engine. The row
  // still SAYS so to a screen reader; on screen it is promoted to a sentence, below.
  expect(screen.getByLabelText(/graveyard.*none keep working/i)).toBeInTheDocument();
  // A class with nothing to say says nothing -- no "0 of them exile" noise on an empty row.
  expect(screen.queryByLabelText(/artifact, no answers.*exile/i)).not.toBeInTheDocument();
  // Spelled out on screen, not abbreviated: `0 ex` / `0 rec` were the two most-misread strings on
  // this panel, including by a reader who guessed "exile" correctly and still called it broken.
  expect(screen.getByText("1 exile")).toBeInTheDocument();
  expect(screen.queryByText(/\bex\b/)).not.toBeInTheDocument();
});

// A UNIFORM MODE IS A FINDING ABOUT THE DECK, NOT A SUFFIX ON SIX ROWS. On a real deck every row
// carries the same one -- the review's deck read "none exile" six times -- and repetition is what
// made the two facts worth acting on invisible.
test("a mode every answer shares is promoted to one sentence and dropped from the rows", () => {
  // TWO answered classes, both with zero exile: a single row's suffix is not repetition, so the
  // promotion deliberately does not fire on one row (the fixture's artifact row has no answers).
  const noExile = {
    ...DECK_MATH,
    answers: DECK_MATH.answers.map((a) => ({ ...a, exiling: 0, count: a.count || 3 })),
  };
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={noExile} />);
  expect(screen.getByText(/Nothing this deck kills is exiled/)).toBeInTheDocument();
  expect(screen.queryByText("none exile")).not.toBeInTheDocument();
  // The graveyard row is the same rule on its own axis: the fixture's hate never recurs.
  expect(screen.getByText(/graveyard hate is one-shot/)).toBeInTheDocument();
  expect(screen.queryByText("none recurring")).not.toBeInTheDocument();
});

// A DISAGREEING COLUMN STILL EARNS ITS SUFFIX -- the promotion fires on uniformity, not on zero.
test("per-row modes survive when the rows disagree", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.getByText("1 exile")).toBeInTheDocument();
  expect(screen.queryByText(/Nothing this deck kills is exiled/)).not.toBeInTheDocument();
});

// NO "SHORT" TARGET (owner, 2026-09-26: "having 5 answers for each type is something no deck can
// provide"). The row says how often one is in hand and which cards they are, not how many short of a
// convention the deck is.
test("an answer row says how often one is in hand and names its cards, with no shortfall", () => {
  const named = { ...DECK_MATH, answers: DECK_MATH.answers.map((a) => (a.class === "creature" ? { ...a, cards: ["Beast Within", "Swords to Plowshares"] } : a)) };
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={named} />);
  // The chance is a bar and its figure on screen, and the sentence in the row's label.
  expect(screen.getByLabelText(/in hand by turn 5 in 41% of games/)).toBeInTheDocument();
  const creature = screen.getByLabelText(/^creature,/i);
  expect(creature).toHaveTextContent("Beast Within · Swords to Plowshares");
  for (const row of screen.getAllByTestId("answer-row")) expect(row).not.toHaveTextContent(/\bshort\b/i);
  // A commander answers every game, so a draw probability would be a lie.
  expect(screen.getByText(/your commander, so every game/)).toBeInTheDocument();
});

// ON A PHONE, A ROW'S CARDS SHOW ON A TAP (owner, 2026-09-27): six rows of names read as a block of
// text at 390px. The names stay in the row (hidden below `sm`, always shown from `sm` up).
test("on a phone an answer row's cards are hidden until its chevron is tapped", () => {
  const named = { ...DECK_MATH, answers: DECK_MATH.answers.map((a) => (a.class === "creature" ? { ...a, cards: ["Beast Within", "Swords to Plowshares"] } : a)) };
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={named} />);
  const creature = screen.getByLabelText(/^creature,/i);
  const cards = within(creature).getByTestId("answer-cards");
  expect(cards.className).toMatch(/(^|\s)hidden(\s|$)/);
  expect(cards.className).toMatch(/sm:block/);
  const which = within(creature).getByRole("button", { name: "Which cards" });
  expect(which).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(which);
  expect(within(creature).getByRole("button", { name: "Hide the cards" })).toHaveAttribute("aria-expanded", "true");
  expect(cards.className).not.toMatch(/(^|\s)hidden(\s|$)/);
});

// Task 6: the coefficient discounts a colourless-pool zero on purpose; the panel is where that
// finding has to survive in words, since the score itself just reads as a smaller number.
test("BuildBenchmarks names the colour pool on a zero row, so the pie is not read as a mistake", () => {
  const withPool = {
    ...DECK_MATH,
    answers: DECK_MATH.answers.map((a) => (a.class === "artifact" ? { ...a, pool: 56 } : a)),
  };
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={withPool} />);
  expect(screen.getByText(/your colours have 56 cards that could/i)).toBeInTheDocument();
});

test("BuildBenchmarks says nothing about a colour's pool when it was never resolved", () => {
  // DECK_MATH's artifact row carries no `pool` at all -- absent, not zero, per the field's own
  // doc comment ("Absent when no commander was detected"). A printed 0 would assert the colours
  // have no answers, which is false; it must render nothing.
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.queryByText(/your colours offer/i)).not.toBeInTheDocument();
});

test("BuildBenchmarks warns a graveyard deck about the hate it cannot remove", () => {
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      deckMath={DECK_MATH}
      answerCoverage={{ coverage: 0.8, source: "weighted", graveyardVulnerability: 0.635, rows: [] }}
    />,
  );
  expect(screen.getByText(/plan runs through the graveyard/i)).toBeInTheDocument();
  expect(screen.getByText(/19 artifacts/)).toBeInTheDocument();
  expect(screen.getByText(/8 enchantments/)).toBeInTheDocument();
  // DECK_MATH has no enchantment row at all, so both classes read unanswered -- grammatical plural.
  expect(screen.getByText(/answers neither/)).toBeInTheDocument();
});

// Controller finding 2 (task 6 fix round): "this deck answers no artifact" is not English -- the
// singular branch needed its own wording, not just the plural's. One unanswered class (here,
// artifact is answered and enchantment is not) exercises the branch the fixture above never hit.
test("BuildBenchmarks reads grammatically when only one hate class is unanswered", () => {
  const oneAnswered = {
    ...DECK_MATH,
    answers: [
      ...DECK_MATH.answers,
      { class: "enchantment", count: 0, exiling: 0, recurring: 0, fromCommandZone: false, available: 0, required: 6 },
    ].map((a) => (a.class === "artifact" ? { ...a, count: 2 } : a)),
  };
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      deckMath={oneAnswered}
      answerCoverage={{ coverage: 0.8, source: "weighted", graveyardVulnerability: 0.635, rows: [] }}
    />,
  );
  expect(screen.getByText(/has no enchantment removal/)).toBeInTheDocument();
  expect(screen.queryByText(/answers no enchantment\b/)).not.toBeInTheDocument();
  // MINOR 6 (whole-branch review): artifact is ANSWERED here (count 2), so its count must not be
  // cited as a live threat -- only the enchantment count this deck actually lacks.
  expect(screen.getByText(/8 enchantments/)).toBeInTheDocument();
  expect(screen.queryByText(/19 artifacts/)).not.toBeInTheDocument();
});

test("BuildBenchmarks says nothing about hate when the deck has no graveyard plan", () => {
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      deckMath={DECK_MATH}
      answerCoverage={{ coverage: 0.8, source: "weighted", graveyardVulnerability: 0.05, rows: [] }}
    />,
  );
  expect(screen.queryByText(/plan runs through the graveyard/i)).not.toBeInTheDocument();
});

// TASK 5 FIX ROUND 1 (2026-09-01): the coverage dock and the colour-pool-unweighted refusal used
// to be a suffix on the removed Interaction PARENT row; deleting that row silently deleted these
// two disclosures from the product, not just from tests -- `build.ts` still docks Interaction's
// attainment by `answerCoverage.coverage` and still refuses the pool weight with no commander
// detected, and nothing said so. They now live on the `Answers by turn N` header instead, since
// that table is what "N of M classes" is a statement about.
test("the Answers header docks for coverage when the score is docked, naming the classes covered", () => {
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      deckMath={DECK_MATH}
      answerCoverage={{
        coverage: 0.816,
        source: "weighted",
        graveyardVulnerability: 0,
        rows: [
          { class: "creature", poolShare: 1, demand: 0.3, weight: 0.3, covered: true },
          { class: "artifact", poolShare: 1, demand: 0.24, weight: 0.24, covered: false },
          { class: "enchantment", poolShare: 1, demand: 0.21, weight: 0.21, covered: true },
          { class: "planeswalker", poolShare: 1, demand: 0.03, weight: 0.03, covered: false },
          { class: "land", poolShare: 1, demand: 0.21, weight: 0.21, covered: true },
        ],
      }}
    />,
  );
  expect(screen.getByText(/docked for coverage/i)).toBeInTheDocument();
  expect(screen.getByText(/3 of 5 answer classes are covered/i)).toBeInTheDocument();
});

/** I2 (whole-branch review, 2026-09-01). The dock note used to spell "Interaction" into its prose,
 *  which is worse than an unwired selector: after a rename in `build.ts` it would go on rendering
 *  and go on asserting the OLD name. The four tests pinning both directions of that guarantee were
 *  deleted as collateral to the removed parent row -- but the NOTE survived the row, so only its
 *  selector died. The name now travels with `coverageWeighted`, and these are the two directions. */
test("the coverage dock names the parent the flag is on, surviving a rename", () => {
  const renamed = [
    { name: "Board control", count: 11, target: 10, leaves: ["targetedRemoval", "stackInteraction"], coverageWeighted: true },
  ] as unknown as typeof SAMPLE.report.buildParents;
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      parents={renamed}
      deckMath={DECK_MATH}
      answerCoverage={{ coverage: 0.816, source: "weighted", graveyardVulnerability: 0, rows: [] }}
    />,
  );
  expect(screen.getByText(/this deck's Board control score counts at/i)).toBeInTheDocument();
  expect(screen.queryByText(/this deck's Interaction score/i)).not.toBeInTheDocument();
});

/** The other direction: a parent that merely happens to be CALLED "Interaction" is not the one the
 *  score docks, so it must never be named by this note. The note itself still renders -- the dock is
 *  a fact about what the engine did to the score, true whether or not this panel was handed the
 *  `parents` that identify the row -- but it names nobody. */
test("a parent named Interaction without the flag is never named by the dock", () => {
  const unflagged = [
    { name: "Interaction", count: 11, target: 10, leaves: ["targetedRemoval", "stackInteraction"] },
  ] as unknown as typeof SAMPLE.report.buildParents;
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      parents={unflagged}
      deckMath={DECK_MATH}
      answerCoverage={{ coverage: 0.816, source: "weighted", graveyardVulnerability: 0, rows: [] }}
    />,
  );
  expect(screen.getByText(/docked for coverage/i)).toBeInTheDocument();
  expect(screen.queryByText(/Interaction score counts at/i)).not.toBeInTheDocument();
});

test("the Answers header says nothing about coverage when it is fully covered", () => {
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      deckMath={DECK_MATH}
      answerCoverage={{ coverage: 1, source: "weighted", graveyardVulnerability: 0, rows: [] }}
    />,
  );
  expect(screen.queryByText(/docked for coverage/i)).not.toBeInTheDocument();
});

test("the Answers header admits the colour pool was unweighted when no commander was detected", () => {
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      deckMath={DECK_MATH}
      answerCoverage={{ coverage: 1, source: "unweighted", graveyardVulnerability: 0, rows: [] }}
    />,
  );
  expect(screen.getByText(/colour pool unweighted/i)).toBeInTheDocument();
  expect(screen.getByText(/no commander detected/i)).toBeInTheDocument();
  expect(screen.queryByText(/docked for coverage/i)).not.toBeInTheDocument();
});

test("the Answers header says nothing about the pool when a commander WAS detected", () => {
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      deckMath={DECK_MATH}
      answerCoverage={{ coverage: 1, source: "weighted", graveyardVulnerability: 0, rows: [] }}
    />,
  );
  expect(screen.queryByText(/colour pool unweighted/i)).not.toBeInTheDocument();
});

test("BuildBenchmarks shows demand against supply, and refuses a number where none applies", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  // The census key is engine vocabulary; the row says what the key MEANS and keeps the key on
  // `title` for anyone matching a report against `bin/deck-availability.ts`.
  expect(screen.getByLabelText(/anything dying, 2 cards care about it, 2 cause it/i)).toBeInTheDocument();
  // No availability column: it is derived from the two counts beside it and reads 100% on every
  // row that has a supplier, which is a column with no variance.
  expect(screen.queryByText("23%")).not.toBeInTheDocument();
  expect(screen.getByTitle("dies:any")).toBeInTheDocument();
  // The game supplies a combat trigger: 0% would invent a hole, 100% would claim a board state
  // this layer does not model. And the VISIBLE row must not say "0 supply" either -- a zero next
  // to a dash reads as a hole in the deck.
  // "the game supplies it" was true of a phase and false of a SELF trigger, which became
  // self-supplied on 2026-08-27. One wording now covers a phase, combat and a card that triggers
  // itself — and the row still must not be counted as an unmet want.
  expect(screen.getByLabelText(/anything attacking, 3 cards care about it, and it happens on its own/i)).toBeInTheDocument();
  expect(screen.getByText(/3 care · happens on its own/i)).toBeInTheDocument();
});

test("demandSentence says the true ugly thing rather than a plausible wrong one", () => {
  expect(demandSentence("enters:type:creature")).toBe("a creature entering the battlefield");
  expect(demandSentence("enters:subtype:wizard")).toBe("a Wizard entering the battlefield");
  expect(demandSentence("cast:type:artifact+enchantment+instant")).toBe(
    "an artifact, enchantment or instant being cast",
  );
  expect(demandSentence("end-step:any")).toBe("an end step");
  // An unknown verb is NOT dressed up in a phrase it never earned, but the "true ugly thing" is now
  // de-slugified rather than the bare key -- a colon-separated identifier read as evidence of a
  // template to four separate player reviews (task 8 brief), and de-slugifying is still honest
  // about not knowing the verb without looking like engine internals.
  expect(demandSentence("bushido:type:creature")).toBe("bushido type creature");
});

// TASK 8: `combat-damage` sat in `DEMAND_PHASE`, which only fires when the subject is `any` -- so
// the single biggest raw-key offender (22 of 71 decks' worth) fell PAST it with a typed subject and
// printed the key verbatim. It is an event with a subject (a CREATURE dealing combat damage), not a
// phase, and belongs in `DEMAND_VERB` like any other verb.
test("combat-damage reads as an event with a subject, not a phase", () => {
  expect(demandSentence("combat-damage:type:creature")).toBe("a creature dealing combat damage");
  expect(demandSentence("combat-damage:type:permanent")).toBe("a permanent dealing combat damage");
  // The " (narrowed)" suffix is a real combat-trigger distinction (census.ts's `consumerKey`) and
  // must survive the move out of the phase map.
  expect(demandSentence("combat-damage:type:creature (narrowed)")).toBe(
    "a creature dealing combat damage (a real one, not the game's own)",
  );
});

// `begin-combat` is one of `availability.ts`'s three `PHASE_VERBS` and was simply absent, so it
// fell through DEMAND_PHASE (no entry) and DEMAND_VERB (also no entry) to the raw key.
// `draw-step` was the opposite defect: it sat in the phase map and is never a real trigger verb
// (`draw` is; `draw-step` is not a `VERB_VOCAB` member at all), so it did nothing but risk masking
// a future bug the same way `combat-damage` masked this one.
test("begin-combat is a phase, and phases match availability.ts's own PHASE_VERBS", () => {
  expect(demandSentence("begin-combat:any")).toBe("the beginning of combat");
});

// The rest of task 8's measured 53 raw rows: every verb this brief named, plus the two DEMAND_VERB
// wrote a comment about (`proliferate`, `counter-added`) rather than a plain lookup.
test("every verb the controller measured reaching the demand list as a raw key now reads as English", () => {
  expect(demandSentence("draw:any")).toBe("a card being drawn");
  expect(demandSentence("counter-added:type:creature")).toBe("a creature getting a counter");
  expect(demandSentence("non-combat-damage:type:permanent")).toBe("a permanent dealing noncombat damage");
  expect(demandSentence("leaves:any")).toBe("anything leaving the battlefield");
  expect(demandSentence("leaves:type:creature")).toBe("a creature leaving the battlefield");
  expect(demandSentence("leaves:type:artifact")).toBe("an artifact leaving the battlefield");
  expect(demandSentence("dice-rolled:any")).toBe("a die being rolled");
  expect(demandSentence("discard:any")).toBe("anything being discarded");
  expect(demandSentence("gain-life:any")).toBe("life being gained");
  // proliferate names no card type in the corpus (it is a player action over "any number" of
  // permanents/players with counters, never scoped to a card type) -- but unlike `attacks:any`,
  // where "anything attacking" is TRUE of a permanent, nothing but a PLAYER proliferates, so it no
  // longer glues "anything" onto the front (review finding F1, fix round 1).
  expect(demandSentence("proliferate:any")).toBe("proliferating");
  // None of these may contain the raw separators a reader mistook for a template.
  for (const key of [
    "draw:any", "counter-added:type:creature", "non-combat-damage:type:permanent", "leaves:any",
    "dice-rolled:any", "discard:any", "gain-life:any", "proliferate:any",
    "combat-damage:type:creature", "begin-combat:any",
  ]) {
    expect(demandSentence(key)).not.toMatch(/[:-]/);
  }
});

// F1 (task 8 fix round 1): `demandSentence` glued a permanent subject onto five PLAYER-only verbs,
// producing a grammatical sentence that is FALSE -- "anything drawing a card" claims a permanent
// draws, when only a player ever does. FAILS against the pre-fix strings ("anything drawing a
// card", "anything gaining life", "anything losing life", "anything rolling a die", "anything
// proliferating"); passes once each reads as the whole demand with no subject glued on, the same
// structural move `DEMAND_PHASE` already makes for a phase.
test("draw, gain-life, lose-life, dice-rolled and proliferate read as their true sentence, not a false one glued to a subject", () => {
  expect(demandSentence("draw:any")).toBe("a card being drawn");
  expect(demandSentence("gain-life:any")).toBe("life being gained");
  expect(demandSentence("lose-life:any")).toBe("life being lost");
  expect(demandSentence("dice-rolled:any")).toBe("a die being rolled");
  expect(demandSentence("proliferate:any")).toBe("proliferating");
});

// STEP 5: no output of `demandSentence`, mapped or not, may contain a raw census separator -- fed
// every shape task 8 measured plus a verb the engine does not have yet, so a verb added tomorrow
// without a matching entry degrades to readable words instead of shipping its own name back.
test("demandSentence never emits a colon or a dash, mapped verb or not", () => {
  const keys = [
    "enters:type:creature", "enters:subtype:wizard", "cast:type:artifact+enchantment+instant",
    "end-step:any", "begin-combat:any", "upkeep:any",
    "combat-damage:type:creature", "combat-damage:type:creature (narrowed)", "combat-damage:type:permanent",
    "non-combat-damage:type:permanent", "draw:any", "leaves:any", "leaves:type:creature",
    "leaves:type:artifact", "counter-added:type:creature", "counter-added:any", "discard:any",
    "gain-life:any", "proliferate:any", "dice-rolled:any",
    // A verb this map has never seen, exactly the shape a future engine verb would arrive as.
    "some-future-verb:type:creature",
  ];
  for (const key of keys) {
    expect(demandSentence(key)).not.toMatch(/[:-]/);
  }
});

test("BuildBenchmarks shows the measured clock, and calls it what it is", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.getByLabelText(/beats one opponent on turn 8, 6.4 expected power at turn 5/i)).toBeInTheDocument();
  // Optimistic by construction -- nobody blocks in this model -- and a turn number that does not
  // say so reads as a prediction rather than a rate.
  expect(screen.getByText(/nobody blocks/i)).toBeInTheDocument();
});

test("a deck with no combat clock says so rather than naming a turn", () => {
  const noClock = { ...DECK_MATH, clock: { powerAtFive: 0.4 } };
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={noClock} />);
  expect(screen.getByLabelText(/no combat clock/i)).toBeInTheDocument();
});

// THE PLANS NAME THEIR CARDS (owner, 2026-09-26: "determine how the deck can win"). The counts
// alone were what the baseline round's plan seat could not act on: "pick a way" needs the cards.
test("BuildBenchmarks names each win plan's cards and go-wide's payoffs", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  // In words (wording review 2026-09-25): 0.52 across two plans is close to an even split.
  expect(screen.getByTestId("win-plans-headline")).toHaveTextContent("Spread about evenly across 2 plans.");
  const [wide, burn] = screen.getAllByTestId("win-plan");
  expect(wide).toHaveTextContent("Attacking with a wide board12 cards");
  // One plan's cards at a time: the first to start with.
  const detail = () => screen.getByTestId("win-plan-detail");
  expect(detail()).toHaveTextContent("Makes the boardToken Maker 1Token Maker 2");
  expect(detail()).toHaveTextContent("Turns it into a winIntangible Virtue");
  // Eight names, then the rest on request.
  expect(detail()).not.toHaveTextContent("Token Maker 9");
  fireEvent.click(within(detail()).getByRole("button", { name: "Show all 12" }));
  expect(detail()).toHaveTextContent("Token Maker 12");
  fireEvent.click(burn!);
  expect(detail()).toHaveTextContent("Impact TremorsLightning Bolt");
  expect(screen.queryByText(/Concentration/)).toBeNull();
});

/** THE MANA ROWS WRAP RATHER THAN OVERFLOWING THE COLUMN THEY ARE GIVEN.
 *
 *  Measured 2026-09-03 on the example deck, before this: the lands row's fixed columns (`w-52` plus
 *  `w-16` plus two 12px gaps, 296px) sat in a row that gets 326px on a 390px phone and **292px at
 *  1440**, where `xl:grid-cols-2` halves the panel. The sentence between them was left 60px -- a
 *  272px-tall ribbon two words wide -- and `wants 36` was pushed 30px past the column on a phone
 *  and 65px past it on the desktop, over the next grid column. The colour rows had the same shape,
 *  and their `sm:w-24` gutter made it worse: a VIEWPORT query cannot see that the container it is
 *  in is 292px, so the wide gutter arrived exactly where there was no room for it.
 *
 *  jsdom lays nothing out, so what is asserted here is the CONTRACT that made the layout wrong: no
 *  fixed-width column in a row whose width is not a viewport. The numbers above came from the
 *  browser and are repeated in the commit. */
test("no mana row pins a fixed-width column it cannot fit", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  const rows = [
    screen.getByLabelText(/lands in the deck/i),
    ...screen.getAllByLabelText(/sources.*by turn|sources, enough/i),
  ];
  expect(rows.length).toBeGreaterThan(1);
  for (const row of rows) {
    expect(row.className, row.getAttribute("aria-label") ?? "").toContain("flex-wrap");
    // `w-6` on the pip cell is allowed: one glyph is one glyph at every width. What is refused is a
    // column sized in rems against a container the class cannot see.
    expect(row.className).not.toMatch(/\b(sm:)?w-(16|24|40|52)\b/);
    for (const cell of row.children) {
      expect(cell.className, (cell.textContent ?? "").slice(0, 30)).not.toMatch(/\b(sm:)?w-(16|24|40|52)\b/);
    }
  }
});

test("BuildBenchmarks shows the land count the deck's own curve asks for", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  // Deck-derived, and now the SAME number buildScore is scored against (task 9) -- and it shows the
  // inputs, because "34" with no working is a number to argue with rather than act on.
  expect(screen.getByLabelText(/37 lands in the deck, this curve wants 34/i)).toBeInTheDocument();
  // The regression's author is implementation, not a label: the reader is asking how many lands
  // to run, not whose formula answered.
  expect(screen.queryByText(/karsten/i)).not.toBeInTheDocument();
  expect(screen.getByText(/average mana value 2\.7/i)).toBeInTheDocument();
  expect(screen.getByText(/12 cheap mana makers \(2 mana or less\)/i)).toBeInTheDocument();
  expect(screen.getByText(/2 fast mana/i)).toBeInTheDocument();
  // A number scored on the derived target says nothing about "flat convention" -- that wording is
  // reserved for a fallback (next test), and its presence here would be the silent-swap defect.
  expect(screen.queryByText(/flat convention/i)).not.toBeInTheDocument();
});

test("BuildBenchmarks says so when the land target falls back to the flat convention (task 9)", () => {
  // A big-mana deck's curve can ask the regression for more lands than it was ever tested giving --
  // `gatedLandsTarget` refuses outside [28, 39] and scores the flat 36 instead. The row must show
  // THAT number (matching what buildScore used) and say why, not silently swap between two figures
  // that mean different things.
  const fallback = {
    ...DECK_MATH,
    lands: { ...DECK_MATH.lands, target: 36, targetSource: "flat" as const, rawTarget: 50 },
  };
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={fallback} />);
  expect(
    screen.getByLabelText(/37 lands in the deck, this curve wants 36 — the usual Commander count; the formula that fits lands to a curve would ask for 50, outside the range it was tested on/i),
  ).toBeInTheDocument();
  // Baseline round 2026-09-26: one number checked against, and the other one explained, so the
  // box no longer reads as the site disagreeing with itself.
  expect(screen.getByText(/36 is the usual Commander count, and it is the one checked here: the formula that fits lands to a curve would ask for 50 with this one, but it was only tested on lower curves/i)).toBeInTheDocument();
});

test("BuildBenchmarks says so when an archetype delta is folded into the land target (fix F1, task 9)", () => {
  // rakdos-landfall's exact shape (controller review 2026-08-21): a derived 39 from the curve, plus
  // landfall's own +4, scored as 43 -- and the panel must say why 43 is not simply the curve's own
  // answer, the same "never swap silently" rule the flat-fallback test above already covers.
  const landfall = {
    ...DECK_MATH,
    lands: { ...DECK_MATH.lands, target: 43, targetSource: "derived" as const, rawTarget: 39, archetypeDelta: 4, archetypeLabel: "Landfall" },
  };
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={landfall} />);
  expect(
    screen.getByLabelText(/37 lands in the deck, this curve wants 43 — 39 from the curve plus 4 because this is a landfall deck/i),
  ).toBeInTheDocument();
  expect(screen.getByText(/39 from the curve plus 4 because this is a landfall deck/i)).toBeInTheDocument();
  // Never the flat-convention wording on a purely-derived-plus-delta row.
  expect(screen.queryByText(/flat convention/i)).not.toBeInTheDocument();
});

test("BuildBenchmarks shows a colour that cannot pay its own pips on time", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  // The spec's own worked sentence, at the MULLIGAN-CORRECTED requirement (roadmap L5): 12 cards
  // want {B}{B} by T3, that needs 21 sources, you run 18. The raw figure this row used to show was
  // 33 -- and at 26 sources, the count the fixture carried until 2026-08-25, the corrected model
  // says the colour is fine, which is the over-claim the correction removes.
  // T18b: the label names BOTH counts, because they are different questions -- 18 sources in the
  // deck, 13 of them able to produce by the turn the demand is due.
  const bRow = screen.getByLabelText(/B, 18 sources, 13 of them by turn 3, when 12 cards want 2 pips and that needs 21/i);
  expect(bRow).toBeInTheDocument();
  // The label above is spelled in words on purpose (screen readers), but the VISIBLE pip phrase
  // ("2 cards want {B}{B} on turn 3") must render as symbols, never brace text -- that line has no
  // other coverage, and reverting it alone would pass the rest of the suite unnoticed.
  expect(within(bRow).getAllByRole("img", { name: /mana/i }).length).toBeGreaterThan(0);
  expect(within(bRow).queryByText(/\{[^}]+\}/)).toBeNull();
  // A colour that pays for itself says so rather than being dropped -- an absent row would read as
  // "not checked".
  expect(screen.getByLabelText(/U, 30 sources, enough/i)).toBeInTheDocument();
});

/** S4 (roadmap L5): the row shows the mulligan-corrected requirement, so the raw one has to be
 *  ON SCREEN somewhere or the reader cannot tell which model produced the number. A caveat naming
 *  only one end lets the pair collapse back to a point the next time somebody edits the copy. */

test("BuildBenchmarks says whether you can CAST it, and names colour when that is the problem", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  // A RANGE, and the range is the PLAY POLICY: the low end holds up two mana, the high end spends
  // everything on acceleration. A single number would have to pick one of the two.
  expect(screen.getByLabelText(/Ulamog, 3% – 11% to cast by turn 10/i)).toBeInTheDocument();
  // WHICH PROBLEM IT IS. Damnation's mana is there 70-90% of the time and it casts 61-78%, so the
  // gap is the colours -- a different deck problem from being short on mana, fixed differently.
  expect(screen.getByLabelText(/Damnation, 61% – 78% to cast by turn 4, mana alone 70% – 90%/i)).toBeInTheDocument();
  // Ulamog's colours line up, so it gets no second number: below the gap it would say the same
  // thing twice, which is how a panel stops being read.
  expect(screen.getByLabelText(/Ulamog/i).textContent).not.toMatch(/mana alone/i);
  // THE DEADLINE IS ON SCREEN, not only in the aria-label. Four cards of equal mana value tie at
  // the same percentage by construction, and a bare "3%" repeated down the block was read as a
  // broken readout by three of four player reviews.
  expect(screen.getByText(/3% – 11% to cast by turn 10/i)).toBeInTheDocument();
});

/** A DEGENERATE RANGE COLLAPSES TO ONE FIGURE. "91% – 91%" reads as a broken readout, and the first
 *  cut of this panel printed exactly that on the diagnostic line -- found in a live browser on a
 *  real deck, not by any test. */
test("BuildBenchmarks never prints a range whose two ends are the same figure", () => {
  const math = {
    ...DECK_MATH,
    castability: {
      refused: 0, biases: "", cards: [
        { name: "Path to Exile", turn: 1, castable: { low: 0.31, high: 0.31 }, mana: { low: 0.912, high: 0.914 } },
      ],
    },
  } as never;
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={math} />);
  expect(screen.getByText(/31% to cast by turn 1/i)).toBeInTheDocument();
  expect(screen.getByText(/^mana alone 91%$/i)).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/(\d+)% – \1%/);
});

/** Two land numbers used to reach one panel -- this regression's (an MDFC is a spell worth a
 *  fraction of a land) and the build category's (an MDFC is a land, by type line) -- and the row
 *  existed to reconcile them. The owner ruled the split away on 2026-08-31: an MDFC is a land, both
 *  readers count it, and no target is discounted for it. What the row says now is COMPOSITION, and
 *  the assertion below is the guard against the old sentence coming back with the old arithmetic. */
test("the land row names how many lands are MDFCs, and says nothing when there is none", () => {
  const { unmount } = render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.queryByText(/modal DFC/i)).not.toBeInTheDocument();
  unmount();
  const withMdfc = { ...DECK_MATH, lands: { ...DECK_MATH.lands, mdfc: 4 } };
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={withMdfc} />);
  expect(screen.getByText(/4 modal DFCs counted as lands, at full weight and with no discount/i)).toBeInTheDocument();
  // THE BRACKET IS COMPOSITION, NOT A SECOND TOTAL. `actual` already includes the MDFCs, so adding
  // `mdfc` to it -- which is what this row printed until the ruling -- counts them twice.
  // DECK_MATH.lands.actual is 37.
  expect(screen.getByText(/\(4 MDFC\)/)).toBeInTheDocument();
  // Not 41 lands (the answers row's "41%" is a different figure).
  expect(screen.queryByText(/\b41\b(?!%)/)).not.toBeInTheDocument();
});

// ONE LINE SINCE 2026-09-27 (owner: "less is more"): the turn and the cards seen, which move per deck.
test("BuildBenchmarks says the turn its figures are priced at, in one line", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.getByText("Checked at turn 5, 12 cards seen.")).toBeInTheDocument();
});

test("a deck with no clock says its turn is the corpus median", () => {
  const noClock = { ...DECK_MATH, turnSource: "corpus-median" as const, turn: 9, seen: 16, clock: { powerAtFive: 0.4 } };
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={noClock} />);
  expect(screen.getByText("Checked at turn 9, 16 cards seen.")).toBeInTheDocument();
});

test("BuildBenchmarks says how many cards its figures assume you have seen", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  // Unweighted supply and no-opponent are not footnotes to look up later: without them a reader
  // takes 41% as a fact about their deck rather than about a hypergeometric draw.
  expect(screen.getByText(/12 cards seen/i)).toBeInTheDocument();
});

test("BuildBenchmarks renders without deck math at all", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} parents={SAMPLE.report.buildParents} />);
  // Ramp is a single-leaf parent, so it renders nothing (task 5) -- Draw is a Consistency leaf
  // and still renders without any deckMath present.
  expect(screen.getByText(/^Draw$/)).toBeInTheDocument();
  expect(screen.queryByText(/answers by turn/i)).not.toBeInTheDocument();
});

/** RESIDUAL FIX (2026-09-01). "single-leaf parents alone render no heading" (above) only proved the
 *  heading-over-nothing case where the WHOLE component bails out (`!hasBenchmarkContent && !deckMath`
 *  is true with no `deckMath`, so `return null` fires before the heading is ever reached). The Build
 *  sub-tab -- this component's one real call site with `parents` at all -- always passes `deckMath`
 *  too, and with `deckMath` present that early return does not fire: `showBenchmarks && (...)` used
 *  to render "How the roles are spent" regardless, over the empty `<ul>` a `buildParents` of only
 *  single-leaf parents leaves behind. The old fixture's assertion (`container` empty) could not have
 *  caught this, because `deckMath`'s own rows mean the container is never empty either way. */
test("a single-leaf-parents deck with deckMath present still hides the role-spend heading", () => {
  const singles = [
    { name: "Ramp", count: 8, target: 10, leaves: ["ramp"] },
    { name: "Board wipes", count: 1, target: 3, leaves: ["boardWipe"] },
  ] as unknown as typeof SAMPLE.report.buildParents;
  render(<BuildBenchmarks categories={SCRAMBLED_CATEGORIES} parents={singles} deckMath={DECK_MATH} />);
  expect(screen.queryByText(/How the roles are spent/i)).toBeNull();
  // Confirms the DOM isn't merely empty for an unrelated reason -- deckMath's own rows are why the
  // component didn't bail out to `return null` altogether, and they're expected to render normally.
  expect(screen.getByText(/answers by turn/i)).toBeInTheDocument();
});

// TASK 5 (2026-09-01): the health dashboard used to be one render -- SYNERGY, the role-spend block
// and Suggestions all on screen together. The sub-tabs split them: the scores live on Engine.
// (The role-spend block itself -- "How the roles are spent" -- is pinned to the Build sub-tab
// specifically by the isolation tests below, fix round 1.)
// TASK 6 (2026-09-01): Suggestions and the findings' own figures (Ramp, under target) moved again,
// off Summary onto Fixes -- see the Fixes-tab tests below. (S10, 2026-09-02: the Suggestions panel
// itself is gone; the findings' figures stayed.)
test("OverviewTab shows the health dashboard, across its sub-tabs", async () => {
  render(<MemoryRouter><ReportChapters data={SAMPLE} /></MemoryRouter>);
  // S10 (2026-09-02): the `Suggestions` assertion that stood here went with the panel. Every
  // suggestion it could show is already a finding's action line -- which is what its own comment
  // recorded, and why deleting it lost no content.
  // "Ramp" is a finding's own figure label (Fixes is under target on it) -- present, not unique.
  expect(screen.getAllByText("Ramp").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Synergy").length).toBeGreaterThan(0); // the lead dial
});

/** FIX ROUND 1 (controller ruling, 2026-09-01): FINDING 1 -- `sections`/`only` only ever filtered
 *  `DeckMathRows`, so the category/parent block (the role-spend heading, `scoredParents`'
 *  group headers, their leaf rows, and any `ungrouped` bar) rendered identically on Build, Mana AND
 *  Engine, three copies of the same Consistency/Interaction groups. `BuildBenchmarks`'
 *  `showBenchmarks` prop (default `true`, `false` on the Mana and Engine call sites) fixes it; this
 *  is the isolation test that would have caught it, per FINDING 2. */

/** THE ISOLATION TESTS BECOME COUNTING TESTS (S7). `sections`/`showBenchmarks` exist because the
 *  category/parent block once rendered identically on Build, Mana AND Engine -- three copies of the
 *  same Consistency/Interaction groups. Under sub-tabs the defect was invisible (you saw one copy
 *  per tab) and the pin was "not on the other tab". In one scroll a reader meets every copy, so the
 *  pin is EXACTLY ONCE in the whole report, which is a strictly stronger statement than the pair of
 *  absence assertions it replaces. */
// The Roles chapter's shelves print each role's count against its target; the bars that drew the
// same counts again under them are gone (owner, 2026-09-26: "duplicate of the previous information").
test("the role counts are not drawn a second time under the shelves", () => {
  render(<MemoryRouter><ReportChapters data={SAMPLE} /></MemoryRouter>);
  expect(screen.queryByText(/How the roles are spent/i)).toBeNull();
});

/** FINDING 2 (fix round 1): the deck-math sections `BuildBenchmarks` routes to the Build sub-tab
 *  (`sections={["answers", "win"]}`) need their own presence/absence pins -- nothing previously
 *  asserted Build's OWN content, which is exactly the gap that let Finding 1 through unnoticed. */

test("answers render once in Roles, and how the deck wins once in Game plan", () => {
  // Needs `deckMath` -- see the comment on the Mana test below for why it's layered on locally.
  const data = { ...SAMPLE, report: { ...SAMPLE.report, deckMath: DECK_MATH } };
  const { container } = render(<MemoryRouter><ReportChapters data={data} /></MemoryRouter>);
  expect(screen.getAllByText("Can you deal with theirs")).toHaveLength(1);
  expect(within(container.querySelector("section#roles") as HTMLElement).getByText("Can you deal with theirs")).toBeInTheDocument();
  // Moved out of Roles (appeal review 2026-09-26): how the deck wins is its plan.
  expect(screen.getAllByText("How you win")).toHaveLength(1);
  expect(within(container.querySelector("section#plan") as HTMLElement).getByText("How you win")).toBeInTheDocument();
});

/** MINOR 9 (whole-branch review, 2026-09-01). `sections={["waiting"]}` is the ENTIRE deck-math
 *  contribution of the Engine sub-tab, and nothing asserted it: dropping the prop, or changing it
 *  to `["cast"]`, failed no test. Build and Mana each already had this pin; Engine did not. */

/** `waiting` CAME OFF THE DISSOLVED ENGINE TAB, landed in Roles, and moved on to Game plan with
 *  "How you win" (appeal review 2026-09-26): what the cards wait for is the deck's plan. Nothing else may pick it up, and it may not be dropped on the way: without this pin,
 *  deleting the section from the `sections` array fails no test. */
test("the waiting section rides the Game plan chapter, exactly once, when something is unmet", () => {
  const unmet = { ...DECK_MATH, demand: [...DECK_MATH.demand, { key: "sacrifice:artifact", consumers: 2, suppliers: 0, available: 0, fromCommandZone: false }] };
  const data = { ...SAMPLE, report: { ...SAMPLE.report, deckMath: unmet } };
  const { container } = render(<MemoryRouter><ReportChapters data={data} /></MemoryRouter>);
  expect(screen.getAllByText("What your cards are waiting for")).toHaveLength(1);
  expect(within(container.querySelector("section#plan") as HTMLElement).getByText("What your cards are waiting for")).toBeInTheDocument();
});

/** LESS IS MORE (owner, 2026-09-27): with every demand met the section said only that, under a
 *  second copy of the turn-7 line. */
test("with nothing unmet, the waiting section is not drawn", () => {
  const data = { ...SAMPLE, report: { ...SAMPLE.report, deckMath: DECK_MATH } };
  render(<MemoryRouter><ReportChapters data={data} /></MemoryRouter>);
  expect(screen.queryByText("What your cards are waiting for")).toBeNull();
});

/** I3 (whole-branch review, 2026-09-01): Build and Mana shipped with no title element at all, so
 *  each opened on a heading with no parent and the sentence saying these panels are the EVIDENCE
 *  for the findings was gone from the product. Both halves are pinned -- the `h2` and the
 *  link back -- because the deleted `Movement` carried both.
 *
 *  FIX ROUND 1 (task 6, 2026-09-01): the findings moved off Summary onto Fixes; the sentence's
 *  wording moved with them (see the dedicated regression test below, which pins this specifically). */

/** Both halves are pinned -- the movement heading and the link back -- because the deleted
 *  `Movement` carried both, and the evidence chapters shipped once with neither.
 *
 *  S7: the movement heading is an `h3` now. The chapter's own question is the `h2` above it, so a
 *  movement that stayed at `h2` would leave the outline flat rather than nested. */
/** T1: the movement HEADINGS are gone -- each restated its own chapter title one line above it --
 *  and the sentence that is not a restatement stays. That sentence is the cross-reference telling a
 *  reader these panels are the evidence behind the findings further down, which no heading said. */
test("the Mana and Roles chapters say what they are evidence for, without restating their title", () => {
  const data = { ...SAMPLE, report: { ...SAMPLE.report, deckMath: DECK_MATH } };
  render(<MemoryRouter><ReportChapters data={data} /></MemoryRouter>);

  expect(screen.getByText(/which of your cards remove their permanents/i)).toBeInTheDocument();
  expect(screen.getByText(/numbers behind the mana suggestions/i)).toBeInTheDocument();

  expect(screen.queryByText("What this deck plays")).toBeNull();
  expect(screen.queryByText("Whether the mana delivers it")).toBeNull();
});

/** THE MOVEMENT COPY NAMES THE TAB THE FINDINGS ARE ACTUALLY ON. Build and Mana call themselves the
 *  evidence behind the findings, and when the diagnosis moved to Fixes these two sentences kept
 *  pointing at Summary -- rendered text telling the reader to look where nothing is. */

/** THE MOVEMENT COPY NAMES WHERE THE FINDINGS ACTUALLY ARE. These two sentences have now been
 *  wrong twice -- they pointed at Summary after the diagnosis moved to Fixes, and at "Fixes" after
 *  the sub-tabs became chapters. In one scroll the honest word is a direction, not a tab name. */
test("the evidence movements point at the chapter the findings actually live in", () => {
  render(<MemoryRouter><ReportChapters data={SAMPLE as never} /></MemoryRouter>);
  expect(screen.getByText(/the numbers behind the mana suggestions below/)).toBeInTheDocument();
  expect(screen.queryByText(/on Suggestions/)).toBeNull();
});

/** The outline must not skip or invert on any sub-tab (WCAG 1.3.1). Asserted as a PROPERTY of the
 *  rendered document rather than as a list of expected headings, so it keeps holding as panels are
 *  added: every heading is at most one level below the one before it. */

/** The outline must not skip or invert anywhere in the report (WCAG 1.3.1). Asserted as a PROPERTY
 *  of the rendered document rather than as a list of expected headings, so it keeps holding as
 *  panels are added: every heading is at most one level below the one before it.
 *
 *  S7 makes this a stronger test than it was: the whole report is ONE document now, so a chapter
 *  whose panels open on an `h4` is caught against the chapter before it rather than being measured
 *  in isolation on its own tab. */
test("the report's heading outline never skips a level", () => {
  const data = { ...SAMPLE, report: { ...SAMPLE.report, deckMath: DECK_MATH } };
  render(<MemoryRouter><ReportChapters data={data} /></MemoryRouter>);
  const seen = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => Number(h.tagName[1]));
  expect(seen.length).toBeGreaterThan(0);
  expect(seen[0], "the report opens below h2").toBeLessThanOrEqual(2);
  for (let i = 1; i < seen.length; i++) {
    expect(seen[i]! - seen[i - 1]!, `h${seen[i - 1]} -> h${seen[i]}`).toBeLessThanOrEqual(1);
  }
});

/** FINDING 3 (fix round 1): the Mana isolation test below already proves Summary unmounts when you
 *  leave it (Summary -> Mana). Nothing proved the same for the other two sub-tabs it can also
 *  reach directly from Summary's default render.
 *
 *  TASK 6 (2026-09-01): "What is wrong with this deck" moved off Summary entirely, onto Fixes --
 *  swapped for "Where this deck stands", the gauges' own heading, which is what Summary carries now. */

/** THE CHAPTERS ARE ALL MOUNTED, AND EACH BLOCK APPEARS ONCE. The sub-tabs' guarantee was that
 *  leaving a tab unmounted its content; the scroll's guarantee is that nothing is duplicated across
 *  chapters, which is the failure mode a single column actually has. */
test("each chapter's own heading appears exactly once in the scroll", () => {
  render(<MemoryRouter><ReportChapters data={SAMPLE} /></MemoryRouter>);
  // The chapter titles themselves (T1 renamed them off the question form). "Roles" is deliberately
  // not in this list: it is a common word that the role table below it uses as ordinary prose, and
  // an exact-text count would be asserting something about that table instead.
  for (const heading of [
    "Deck at a glance",
    "Scores and bracket",
    "Game plan",
    "Manabase",
    "How to improve it",
    "What to change",
  ]) {
    expect(screen.getAllByText(heading), heading).toHaveLength(1);
  }
});

/** THE SEQUENCE, pinned. Four persona reviews (2026-08-26) found the page led with its weakest
 *  answer; the fix is an ORDER, so an order is what the test asserts — the diagnosis must come
 *  before the scores in document order, not merely both exist. Proven to fire by moving `Findings`
 *  below `HeadlineScores` in `OverviewTab`.
 *
 *  I2 (whole-branch review, 2026-09-01): the branch's whole point — recognition before diagnosis —
 *  had NOTHING pinning it. `RecognitionPanel` ("What this deck is") sitting above `Findings` ("What
 *  is wrong with this deck") in `OverviewTab.tsx` was true only by inspection; nothing here failed
 *  if the two sections were swapped back. Extended, not a new test, so the one assertion that
 *  reordering the page breaks stays in one place next to the pattern it was proven against.
 *
 *  TASK 5 (2026-09-01): the scores moved to their own Engine sub-tab, so "demotes the scores below
 *  it" is no longer one render's document order -- it is which sub-tab you are on. Split in two:
 *  recognition-before-diagnosis stays a same-render ordering assertion on Summary (the guarantee
 *  this test exists to pin), and the scores get their own Engine-tab assertion below.
 *
 *  TASK 6 (2026-09-01): the diagnosis itself ("What is wrong with this deck") moved off Summary
 *  onto Fixes, so there is no longer a same-render diagnosis to order against. `DeckGauges`
 *  ("Where this deck stands") is what replaced it on Summary, so the ordering guarantee this test
 *  exists to pin -- recognition leads whatever follows it -- now runs against that instead. */

/** THE SEQUENCE, pinned. Four persona reviews (2026-08-26) found the page led with its weakest
 *  answer; the fix is an ORDER, so an order is what the test asserts. Proven to fire by moving
 *  `Findings` above `RecognitionPanel`.
 *
 *  S7: the order is document order again, across the whole report, which is what the sub-tabs took
 *  away -- under tabs "before" only meant "on an earlier tab", and nothing pinned the tab order. */
test("the report leads with recognition, then the gauges, and ends on the fixes", () => {
  const { container } = render(<MemoryRouter><ReportChapters data={SAMPLE} /></MemoryRouter>);
  // DOCUMENT ORDER OF THE CHAPTERS THEMSELVES, not of three heading strings that T1 removed. The
  // sections carry the ids the rail links to, so this asserts the sequence rather than the wording.
  const ids = [...container.querySelectorAll("section[id]")].map((el) => el.id);
  expect(ids.indexOf("read")).toBeGreaterThanOrEqual(0);
  expect(ids.indexOf("stand")).toBeGreaterThan(ids.indexOf("read"));
  expect(ids.indexOf("fix")).toBeGreaterThan(ids.indexOf("stand"));
});


/** THE SCORES SURVIVED THE ENGINE TAB'S DISSOLUTION. `HeadlineScores` is the only place either
 *  score carries an `Explain` saying what it measures, and the tab it lived on no longer exists --
 *  so the pin is that it is mounted, once, in the chapter that draws the same two numbers as
 *  dials. */
/** ONE COPY OF EACH SCORE IN THE CHAPTER (roadmap S15). The dials print it; `HeadlineScores`'
 *  tiles used to print it again immediately below, which with the sticky header made three copies
 *  of `3.3` in one viewport. The tiles are gone and their words are on the dials, so what is pinned
 *  now is that the chapter draws each score exactly once. */
test("chapter 2 draws each score once, and still says what it measures", () => {
  render(<MemoryRouter><ReportChapters data={SAMPLE} /></MemoryRouter>);
  const stand = document.getElementById("stand")!;
  expect(within(stand).getAllByText("Synergy")).toHaveLength(1);
  expect(within(stand).getAllByText("Build")).toHaveLength(1);
  expect(within(stand).getAllByText("what this measures")).toHaveLength(2);
});

/** SUMMARY IS THE WHOLE PAGE'S FIRST SCREEN. The Overview ran 5,202px -- about nine screens -- and
 *  a reader scrolling it had nothing named to steer by. Five sub-tabs give the length somewhere to
 *  go and give the reader a word to aim at.
 *
 *  TASK 6 (2026-09-01): Summary stopped carrying the findings -- they moved to Fixes -- so what it
 *  carries now, besides recognition, is the gauges. */

/** THE RAIL IS THE TABLE OF CONTENTS, and every chapter it names has to exist as a scroll target:
 *  a rail link pointing at no section is a navigation that silently does nothing. */
test("the rail names six chapters and each one is a section on the page", () => {
  render(<MemoryRouter><ReportChapters data={SAMPLE} /></MemoryRouter>);
  const rail = screen.getByRole("navigation", { name: "Report chapters" });
  for (const c of CHAPTERS) {
    // A BUTTON, NOT AN ANCHOR -- `#<id>` would overwrite the deck payload the hash carries; see
    // `ChapterRail`. What is pinned here is that the rail names it and the section exists to
    // scroll to, which is the navigation actually being offered.
    expect(within(rail).getByRole("button", { name: c.rail })).toBeInTheDocument();
    expect(document.getElementById(c.id), c.id).not.toBeNull();
  }
});

/** TASK 6 (2026-09-01): SUMMARY IS A SUMMARY AGAIN. It carried the entire diagnosis and the entire
 *  prescription -- several screens of it -- on the tab a reader lands on first. Those two are one
 *  thought, what is wrong then what to do about it, so they move together to their own tab rather
 *  than being split across tabs where a finding would sit apart from its own remedy. */

/** THE THREE ESCAPE HATCHES ARE NOT CHAPTERS, and the rail has to say so: they leave the scroll,
 *  so they are links to a route rather than anchors into it. */
test("the rail's reference links route away from the scroll, unlike the chapter anchors", () => {
  render(<MemoryRouter><ReportChapters data={SAMPLE} /></MemoryRouter>);
  const rail = screen.getByRole("navigation", { name: "Report chapters" });
  // DERIVED FROM THE TABLE THE RAIL RENDERS, not spelled out again. Written out, this test asserted
  // `/graph` and friends and went red on its own when the surfaces moved under `/analysis` -- a
  // second copy of a list that already exists in one place.
  for (const surface of REFERENCE_SURFACES) {
    expect(within(rail).getByRole("link", { name: new RegExp(`^${surface.label}`) }))
      .toHaveAttribute("href", surface.path);
  }
  // ...and the chapters are not links at all, so the two kinds cannot be confused for each other.
  expect(within(rail).queryByRole("link", { name: "Mana" })).toBeNull();
});

test("the Fixes tab carries both the diagnosis and the prescription", () => {
  render(<MemoryRouter><ReportChapters data={SAMPLE} /></MemoryRouter>);
  // The diagnosis is the findings list; its heading restated the chapter title and went with T1, so
  // the pin is the count sentence that heading sat beside.
  expect(screen.getByText(/biggest payoff first/i)).toBeInTheDocument();
  expect(screen.getByText("What to change")).toBeInTheDocument();
});


test("the mana chapter carries the castability section, exactly once", () => {
  // SAMPLE carries no `deckMath` -- most of this suite pins BuildBenchmarks against bare
  // `categories`/`parents`, and giving the shared fixture one risked every other SAMPLE consumer
  // (GraphView, GraphList, run-diff) picking up a field none of them asked for. Layered on locally
  // instead (`DECK_MATH`, below), just for the one chapter whose "cast" section has nothing to
  // show without it.
  const data = { ...SAMPLE, report: { ...SAMPLE.report, deckMath: DECK_MATH } };
  render(<MemoryRouter><ReportChapters data={data} /></MemoryRouter>);
  expect(screen.getAllByText("Can you cast your cards")).toHaveLength(1);
});


/** EVERY CHAPTER IS ON THE PAGE AT ONCE -- that is the whole item. The sub-tabs' version of this
 *  test clicked five tabs to prove each was reachable; the scroll's version proves no click is
 *  needed, which is the guarantee that replaced it. */
test("every chapter is mounted in one render, in rail order", () => {
  const { container } = render(<MemoryRouter><ReportChapters data={SAMPLE} /></MemoryRouter>);
  const ids = [...container.querySelectorAll("section[id]")].map((el) => el.id);
  expect(ids).toEqual(CHAPTERS.map((c) => c.id));
});

// Inherited from `HeadlineScores`, which carried the two scores before S15 moved them onto the
// dials: the tone of a score is a semantic token, never a raw palette class.
test("the score dials use semantic tokens, not raw Tailwind palette classes", () => {
  const { container } = render(
    <DeckGauges data={{ report: { synergyOverall: 1.2, buildScore: 1.0 } } as never} />,
  );
  expect(container.innerHTML).not.toMatch(/text-(red|amber|emerald)-\d{3}/);
});

/** S16 — THE SEVEN CROSS-CHAPTER CONTRADICTIONS, pinned where they are wording rather than
 *  arithmetic. Each was true before the report became one scroll and unmeetable while the two
 *  halves sat on different sub-tabs; each was filed by at least one blind judge reading the page
 *  end to end. */
test("the strategy list says why the deck's own theme need not appear in it", async () => {
  const user = userEvent.setup();
  render(<ArchetypeBoard strategies={SAMPLE.report.strategies} archetypes={SAMPLE.report.archetypes} />);
  await user.click(screen.getByText("what the percentages count"));
  expect(screen.getByText(/named archetypes from a fixed list/)).toBeInTheDocument();
  expect(screen.getByText(/will often not be one of these names/)).toBeInTheDocument();
});

test("the cut list's empty state says so when unread cards are the only candidates", () => {
  render(<CutList cuts={[]} slack={[]} unjudged={["Murder"]} />);
  expect(screen.getByText("Nothing here is an easy cut.")).toBeInTheDocument();
});

test("BuildBenchmarks states what a random card off the library is worth, and stays silent without one", () => {
  const { unmount } = render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      deckMath={{
        ...DECK_MATH,
        topdeck: [{
          card: "Hidetsugu and Kairi",
          meanManaValue: 2.63,
          nonlandMeanManaValue: 4.02,
          landShare: 0.37,
          castable: { types: ["instant", "sorcery"], share: 0.46 },
        }],
      }}
    />,
  );
  expect(screen.getByText(/off the top/i)).toBeInTheDocument();
  expect(screen.getByText("2.63")).toBeInTheDocument();
  // Both readings, never one: 4.02 is what a hit is worth when it is not a land, and 37% of hits are.
  expect(screen.getByText(/4\.02 when it is not a land, and 37% of the/)).toBeInTheDocument();
  expect(screen.getByText(/46% of your library is instant or sorcery/)).toBeInTheDocument();
  unmount();
  // Most decks run no such card, and an empty heading is worse than no heading.
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.queryByText(/off the top/i)).not.toBeInTheDocument();
});

// F3: the slack chip printed the raw camelCase key ("targetedRemoval 14/10 (+4)") because this
// file had no label map at all -- BuildBenchmarks' fix for the identical bug (CONFLICT 9,
// `graveyardHate`) could not reach here, since its map was a local `const`. Both now import the
// same `BUILD_CATEGORY_LABEL`.
test("the slack chip names its category in words, not the raw camelCase key", () => {
  render(
    <CutList
      cuts={[]}
      slack={[{ category: "targetedRemoval", count: 14, target: 10, over: 4 }]}
    />,
  );
  expect(screen.getByText(/Removal/)).toBeInTheDocument();
  expect(screen.queryByText(/targetedRemoval/)).not.toBeInTheDocument();
});

// THE TRIM NOTE NAMES NO ROLE (review 2026-09-25). It said "we don't rank one ramp card against
// another" whatever the chips under it were -- Interaction and Consistency on both review decks,
// while the same report called ramp SHORT. Three seats read it as an instruction about ramp.
test("the trim note under the slack chips does not name a role the chips are not", () => {
  render(<CutList cuts={[]} slack={[{ category: "Interaction", count: 17, target: 13, over: 4 }]} />);
  expect(screen.getByText(/we don.t rank the cards inside a role against each other/)).toBeInTheDocument();
  expect(screen.queryByText(/ramp card/)).not.toBeInTheDocument();
});

// --- The card drawer (F8): the inspector, reachable from any card name in the report. ---


test("clicking a card name in the Cards table opens the inspector on that card", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><ReportShell data={SAMPLE} /></MemoryRouter>);
  await user.click(screen.getAllByRole("link", { name: /^Cards/ })[0]!);
  await user.click(screen.getByRole("button", { name: "Krenko, Mob Boss" }));
  const panel = screen.getByTestId("card-inspector");
  expect(within(panel).getByRole("heading", { level: 3 })).toHaveTextContent("Krenko, Mob Boss");
  // The edges come from the graph, both directions, with the reason sentence intact.
  expect(within(panel).getByText(/Krenko makes tokens; Impact Tremors pays off tokens\./)).toBeInTheDocument();
});

// One combo, two pieces: one the deck holds and one it does not. The first opens the inspector;
// the second stays plain text, because a click that does nothing is worse than no affordance --
// and a combo really can name a card outside the deck.

test("a combo piece opens the inspector, Escape closes it, and an unknown piece stays text", async () => {
  const user = userEvent.setup();
  const withStranger = {
    ...SAMPLE,
    report: {
      ...SAMPLE.report,
      combos: [{ cards: ["Krenko, Mob Boss", "Not In This Deck"], result: "Infinite loop" }],
    },
  };
  render(<MemoryRouter><ReportShell data={withStranger} /></MemoryRouter>);
  await user.click(screen.getAllByRole("link", { name: /^Combos/ })[0]!);
  expect(screen.getByText("Not In This Deck")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Not In This Deck" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Krenko, Mob Boss" }));
  const panel = screen.getByTestId("card-inspector");
  expect(panel).toBeInTheDocument();
  // PORTALLED, and this assertion is a regression guard rather than a style preference: the report
  // sits inside `.reveal`, whose animation fill mode leaves a `transform` on the element, and a
  // transformed ancestor is the containing block for `position: fixed` -- so a drawer rendered in
  // place anchors to a 2,000px div and scrolls off screen. jsdom cannot see the layout; it CAN see
  // that the panel is not inside that subtree.
  expect(panel.closest(".reveal")).toBeNull();
  await user.keyboard("{Escape}");
  expect(screen.queryByTestId("card-inspector")).not.toBeInTheDocument();
});

// A COLOUR DEMAND NO DECK CAN MEET IS NOT A SHORTFALL. Each row is one early double-pip card's own
// 90% figure, and the rows are independent demands on the same lands -- the review's deck asked
// 36 + 33 + 33 sources of 34 lands. Amber there says "your mana base is broken" about arithmetic,
// and the honest fix is the spell.
test("colour rows stop crying wolf when the demands cannot all be met", () => {
  const overcommitted = {
    ...DECK_MATH,
    lands: { ...DECK_MATH.lands, actual: 34, target: 35 },
    colors: [
      { color: "U", supplied: 22, worst: { pips: 2, turn: 2, required: 22, requiredRaw: 36, cards: 1, available: 12 } },
      { color: "B", supplied: 20, worst: { pips: 2, turn: 3, required: 21, requiredRaw: 33, cards: 2, available: 15 } },
      { color: "R", supplied: 21, worst: { pips: 2, turn: 3, required: 21, requiredRaw: 33, cards: 1, available: 16 } },
    ],
  };
  const { unmount } = render(
    <BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={overcommitted} />,
  );
  // THE ROW NAMES ITS UNIT NOW and drops the turn its left half already prints once -- the phone
  // judge's third run gave up on this row for want of a noun. Same element, same muted tone.
  expect(screen.getByText("12 sources, wants 22")).toHaveClass("text-(--muted)");
  unmount();

  // ONE ROW CANNOT OVERCOMMIT TOGETHER WITH ITSELF. Found in a live browser on `draguns`: one
  // colour row wanting 37 sources against 36 lands fired "which no deck can hold" on a one-land
  // margin, about a deck that holds nonland sources too.
  const single = {
    ...DECK_MATH,
    lands: { ...DECK_MATH.lands, actual: 36, target: 37 },
    colors: [{ color: "U", supplied: 33, worst: { pips: 3, turn: 3, required: 37, requiredRaw: 44, cards: 1, available: 28 } }],
  };
  const solo = render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={single} />);
  expect(screen.queryByText(/which no\s+deck can hold/)).not.toBeInTheDocument();
  expect(screen.getByText("28 sources, wants 37")).toBeInTheDocument();
  solo.unmount();

  // And it still fires where the gap IS closable: one colour, wanting fewer sources than the deck
  // holds lands.
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.getByText("13 sources, wants 21")).toHaveClass("text-(--warning)");
  expect(screen.queryByText(/which no\s+deck can hold/)).not.toBeInTheDocument();
});

// --- Overview weight (F12). ---

// THE CAVEATS SURVIVE WORD FOR WORD AND STOP COSTING A QUARTER OF THE PANEL. The horizon itself
// stays visible, because a reader who does not know the turn cannot read a single figure below it.
// Asserted on `open`, not on presence: jsdom renders a closed <details>'s children into the DOM, so
// a query for the text finds it either way -- what changes is whether a reader can see it.

// A LIST WHOSE EVERY ROW READS THE SAME WAY IS NOT A FINDING. What matters is a want with nothing
// supplying it -- and on a working deck there are none, which is why the full list folds.
test("wants vs supplies leads with the unmet ones and folds the rest", () => {
  const unmet = {
    ...DECK_MATH,
    demand: [
      { key: "enters:any", consumers: 20, suppliers: 84, available: 1, fromCommandZone: false },
      { key: "dies:any", consumers: 4, suppliers: 0, available: 0, fromCommandZone: false },
    ],
  };
  const { unmount } = render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={unmet} />);
  expect(screen.getByText("1 thing your cards care about, and nothing in the deck causes it.")).toBeInTheDocument();
  // The unmet row leads OUTSIDE the expander, and the satisfied one appears only inside it.
  const folded = screen.getByText("show all 2").closest("details")!;
  expect(folded.open).toBe(false);
  expect(within(folded).getByText("20 care · 84 cause it")).toBeInTheDocument();
  expect(screen.getAllByText("4 care · 0 cause it")[0]).toHaveClass("text-(--warning)");
  expect(screen.queryAllByText("20 care · 84 cause it")).toHaveLength(1);
  unmount();

  // A deck with nothing unmet says so in one line rather than listing rows that all agree.
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.getByText("Everything your cards care about, something in the deck causes.")).toBeInTheDocument();
});

// --- The Cards table (F5). ---

// A RATING IS DECK-RELATIVE and the table never said so: 51 of 94 rows sit under 1.0 on a deck the
// same app rates 4.1 of 5, and a role card is silent BY DESIGN (`ROLE_NOT_SYNERGY`). Without the
// sentence, a reader takes Sol Ring at 0.3 as a verdict.
test("CardList says what the rating is measured against", () => {
  render(<CardList cards={SAMPLE.report.cards} />);
  expect(screen.getByText(/Scored against this deck's best synergy card/)).toBeInTheDocument();
  expect(screen.getByText(/score low on purpose/)).toBeInTheDocument();
});

test("CardList sorts by name and by cost, not only by rating", async () => {
  const user = userEvent.setup();
  const cards = [
    { name: "Zebra Ritual", synergyRating: 4.0, manaValue: 1, roles: [] },
    { name: "Ancient Colossus", synergyRating: 0.2, manaValue: 9, roles: [] },
  ] as never;
  render(<CardList cards={cards} />);
  const names = () => screen.getAllByRole("row").slice(1).map((r) => r.textContent?.split("\n")[0] ?? "");
  expect(names()[0]).toContain("Zebra Ritual"); // rating order, the default

  await user.click(screen.getByRole("button", { name: /^Card/ }));
  expect(names()[0]).toContain("Ancient Colossus"); // alphabetical

  await user.click(screen.getByRole("button", { name: /^Cost/ }));
  expect(names()[0]).toContain("Ancient Colossus"); // most expensive first
});

test("CardList filters by name", async () => {
  const user = userEvent.setup();
  render(<CardList cards={SAMPLE.report.cards} />);
  await user.type(screen.getByRole("searchbox", { name: "Filter cards by name" }), "krenko");
  const rows = screen.getAllByRole("row").slice(1);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.textContent).toContain("Krenko");
});

// A PERCENTAGE WITH NO DENOMINATOR IS NOT A FIGURE, and the bars are scaled to the leader rather
// than to 100%, so the widest one says "most" and not "all".
test("ArchetypeBoard says what its percentages count", () => {
  render(<ArchetypeBoard strategies={SAMPLE.report.strategies} archetypes={SAMPLE.report.archetypes} />);
  expect(screen.getByText("what the percentages count")).toBeInTheDocument();
  expect(screen.getByText(/share of the deck's nonland cards/)).toBeInTheDocument();
  expect(screen.getByText(/do not add to 100%/)).toBeInTheDocument();
});

// The castability range was explained in a footnote on a DIFFERENT tab, so on this one it was two
// unlabelled numbers.
test("CardList explains the cost range on the tab that prints it", () => {
  render(<CardList cards={SAMPLE.report.cards} />);
  expect(screen.getByText("what the cost figures mean")).toBeInTheDocument();
  // The figure is CASTABILITY now — mana and colours together — and the range is the play policy.
  expect(screen.getByText(/mana and colours together/)).toBeInTheDocument();
  expect(screen.getByText(/holds up two mana/)).toBeInTheDocument();
});

// --- F10 / F11: saying a thing once. ---

// THIRTEEN COMMA-JOINED "Infinite X" CLAUSES was the whole row. The count survives; the list does
// not, and the source is named — which also says why the STEPS are absent.
test("ComboList leads with a few results and counts the rest", () => {
  render(<ComboList combos={[{ cards: ["A", "B"], result: "Infinite mana, Infinite tokens, Infinite damage, Infinite draw, Win the game" }]} />);
  expect(screen.getByText(/Infinite mana · Infinite tokens · Infinite damage/)).toBeInTheDocument();
  expect(screen.getByText(/\+2 more/)).toBeInTheDocument();
  expect(screen.queryByText(/Win the game/)).not.toBeInTheDocument();
  expect(screen.getByText(/Commander Spellbook/)).toBeInTheDocument();
});

// ONE MECHANISM, SAID ONCE. On the review deck 25 of 94 rows printed the same sentence with the
// names swapped, and the rows whose reason was DIFFERENT read exactly like the rest.
test("CardList says a shared mechanism once and leaves the distinctive rows their sentence", () => {
  const wiz = (name: string, extra?: string) => ({
    name,
    synergyRating: 2,
    roles: [],
    topPartners: [{
      name: "Inalla",
      score: 2,
      reasons: [
        { tag: "enters:wizard", text: `${name} triggers on a wizard entering; Inalla supplies it` },
        ...(extra ? [{ tag: "dies:creature", text: extra }] : []),
      ],
    }],
  });
  const cards = [
    ...[...Array(6)].map((_, i) => wiz(`Wiz ${i}`)),
    wiz("Odd One", "Odd One returns a creature from your graveyard"),
  ] as never;
  render(<CardList cards={cards} />);
  // The count and the sentence are separate text nodes (React splits `{count}` from the string),
  // so this matches the node that carries the words.
  expect(screen.getByText(/shown once instead of on every row/)).toBeInTheDocument();
  // SEVEN, not six: "Odd One" leads with the shared reason too — what makes it distinctive is the
  // SECOND reason it carries, which is exactly the row the fold has to keep.
  expect(screen.getByText("7").parentElement?.textContent).toMatch(/^7 × Wiz 0 triggers on a wizard entering/);
  // The shared sentence appears ONCE, in the note — not on the six rows that share it.
  expect(screen.getAllByText(/triggers on a wizard entering/)).toHaveLength(1);
  // And the row with something else to say keeps it.
  expect(screen.getByText("Odd One returns a creature from your graveyard")).toBeInTheDocument();
});

// K6: the clock is combat pressure against ONE opponent, and the label used to claim the game.
test("the clock says which opponent it beats, not that it wins the game", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.getByText("Combat pressure")).toBeInTheDocument();
  expect(screen.getByText(/Beats one opponent turn 8/)).toBeInTheDocument();
  // "Kills on turn 8" in a four-player pod reads as "wins on turn 8" -- wrong by a factor of three.
  expect(screen.queryByText(/Kills on turn/)).not.toBeInTheDocument();
});

// L3 (2026-08-25). The bracket panel DESCRIBES and never grades, and it sits one column from two
// real scores out of five — so the copy has to say what the number is about, or "Bracket 4" reads
// as 4/5.
test("the bracket panel names what put the deck there, and never reads as a grade", () => {
  const { unmount } = render(<BracketPanel bracket={{
    band: "4-5",
    gameChangers: ["Rhystic Study"],
    infiniteCombos: 2,
    cheapCombos: [{ cards: ["Isochron Scepter", "Dramatic Reversal"], result: "Infinite untap", manaValue: 4 }],
    reasons: [],
  }} />);
  // The EN DASH: this line prints `CELL_LABEL[band]`, not the wire key, so it matches the cells
  // above it. It was rendering "Bracket 4-5" beside a cell reading "4–5" (S14).
  expect(screen.getByText(/^Bracket 4–5$/)).toBeInTheDocument();
  expect(screen.getByText("casual")).toBeInTheDocument();
  expect(screen.getByText("competitive")).toBeInTheDocument();
  // Named twice on purpose: in the one-sentence reason and in the Game Changers box.
  expect(screen.getAllByText(/Rhystic Study/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/2 infinite combos/).length).toBeGreaterThan(0);
  // S14: the figure carries what it is the total OF. "4 mana total" floated with no label and a
  // beginner read it as a quantity of something unnamed.
  expect(screen.getByText(/4 mana together/)).toBeInTheDocument();
  unmount();

  // 1-2 states the absence rather than rendering an empty list.
  const two = render(<BracketPanel bracket={{ band: "1-2", gameChangers: [], infiniteCombos: 0, cheapCombos: [], reasons: [] }} />);
  // R2-F7: this is the screen a precon owner actually sees, and it named "Wizards' Game Changer
  // list" with no box on THIS screen defining it -- the definition only existed on the 4-5 layout.
  // Baseline round 2026-09-26: "none found" now says what was looked at, so it cannot read as
  // "never looked".
  expect(screen.getByTestId("bracket-why")).toHaveTextContent(/none of its cards is on Wizards' Game Changers list, and no infinite combo Commander Spellbook knows is complete/i);
  // The band does not count these; the table line says whether any card does them (persona round
  // 2026-09-27: "Not checked" read as the opposite of the table line's "nothing takes extra turns").
  expect(screen.getByTestId("bracket-checked")).toHaveTextContent(/The band does not count mass land destruction or chained extra turns/);
  // ZEROS ARE SAID: "none found" must not read as "never looked".
  expect(screen.getByTestId("bracket-counts")).toHaveTextContent("no Game Changers, no infinite combos");
  two.unmount();

  // An analysis with no bracket renders nothing at all, never a heading over an empty panel.
  const { container } = render(<BracketPanel bracket={undefined} />);
  expect(container).toBeEmptyDOMElement();
});

// S14 (filed from S2's judging round, 2026-09-02). S2 fixed the panel's FORM and the beginner then
// could not use it at all: every term was undefined. These pin the four words the judge listed by
// name -- bracket, Game Changer, infinite combo, and the unlabelled mana figure -- plus the footnote,
// which explained the ranges in the words that needed explaining and contradicted its own heading.
test("the bracket panel defines its own vocabulary", () => {
  render(<BracketPanel bracket={{
    band: "4-5",
    gameChangers: ["Rhystic Study"],
    infiniteCombos: 2,
    cheapCombos: [{ cards: ["Isochron Scepter", "Dramatic Reversal"], result: "Infinite untap", manaValue: 4 }],
    reasons: [],
  }} />);
  // T10 (owner, 2026-09-03): *"what bracket is and anything about brackets should just link to
  // wizards brackets guide"*. The definition is Wizards' to maintain and the brackets are still in
  // beta, so the panel points at the source instead of carrying a copy of it. The always-visible
  // orienting line stays -- a reader who never follows a link still has to know which end is which.
  // LESS IS MORE (owner, 2026-09-27): the definitions went; what stays is whose list is whose,
  // one line, and the link to Wizards for the rest.
  const guide = screen.getByRole("link", { name: /bracket guide/i });
  expect(guide).toHaveAttribute("href", "https://magic.wizards.com/en/news/announcements/introducing-commander-brackets-beta");
  expect(guide).toHaveAttribute("rel", expect.stringContaining("noopener"));
  expect(screen.getByTestId("bracket-checked")).toHaveTextContent(/Game Changers are Wizards’ list; the combos are Commander Spellbook’s, and counting them is our call/);
  expect(screen.getByText(/on Wizards’ list/)).toBeInTheDocument();
  expect(screen.getByText(/each repeats without limit/)).toBeInTheDocument();
  // The 4-5 deck gets the 4-vs-5 line only.
  expect(screen.getByText(/depends on the table you take it to/i)).toBeInTheDocument();
  expect(screen.queryByText(/precon/i)).toBeNull();
});

// S14 JUDGE ROUND. The rewrite met its objective and the beginner filed eight findings against it,
// two of them defects the rewrite itself introduced. These pin the two that blocked or misled.
test("the band names its own ends, so a reader knows which end is which without reading", () => {
  render(<BracketPanel bracket={{ band: "1-2", gameChangers: [], infiniteCombos: 0, cheapCombos: [], reasons: [] }} />);
  expect(screen.getByRole("img", { name: /from 1, the most casual table, to 5, the most competitive/ })).toBeInTheDocument();
  expect(screen.getByText("casual")).toBeInTheDocument();
  expect(screen.getByText("competitive")).toBeInTheDocument();
});

// SECOND BEGINNER PASS on the shipped panel (2026-09-02). The first pass's fixes introduced their
// own defects, which is why the panel was judged twice. These pin what the second pass found.
test("the footnote speaks about THIS band and no other", () => {
  // R2-F5: one paragraph carrying both splits printed on every deck, so half of it was always
  // about a range the reader is not in -- "I read it three times looking for the part meant for
  // me". And bracket 3 is a single number: it was being told it had been given "a range".
  const two = render(<BracketPanel bracket={{ band: "1-2", gameChangers: [], infiniteCombos: 0, cheapCombos: [], reasons: [] }} />);
  expect(screen.getByTestId("bracket-checked")).toHaveTextContent(/1 or 2 depends on whether this is a precon/);
  expect(screen.queryByText(/4 or 5 depends/i)).toBeNull();
  two.unmount();

  const three = render(<BracketPanel bracket={{ band: "3", gameChangers: ["Rhystic Study"], infiniteCombos: 0, cheapCombos: [], reasons: [] }} />);
  // NOT "a range rather than one number", because 3 is one number.
  expect(screen.queryByText(/a range rather than one number/i)).toBeNull();
  expect(screen.getByTestId("bracket-checked")).not.toHaveTextContent(/depends on/);
  three.unmount();

  render(<BracketPanel bracket={{ band: "4-5", gameChangers: [], infiniteCombos: 1, cheapCombos: [], reasons: [] }} />);
  expect(screen.getByText(/depends on the table you take it to/i)).toBeInTheDocument();
  expect(screen.queryByText(/telling 1 from 2/i)).toBeNull();
});

test("the dots' count names its own parts, so all of it can be accounted for", () => {
  // R2-F1, filed as BLOCKED: "6 things the brackets look at" against two visible boxes --
  // "that leaves at least three, maybe four, of the six never named anywhere on the panel". The
  // six are 1 + 5 and the reader was left to add two box headings to see it.
  render(<BracketPanel bracket={{
    band: "4-5", gameChangers: ["Jeska's Will"], infiniteCombos: 5,
    cheapCombos: [{ cards: ["Dualcaster Mage", "Ghostly Flicker"], result: "Infinite", manaValue: 6 }],
    reasons: [],
  }} />);
  expect(screen.getAllByTestId("bracket-pip")).toHaveLength(6);
  expect(screen.getByText("1 Game Changer, 5 infinite combos")).toBeInTheDocument();
  // R2-F2: and the disclosure's "two" is now two KINDS, which no longer rivals the count of six.
  expect(screen.queryByText(/^Two things move a deck up/)).toBeNull();
});

test("the mana figure says what it is the total of, without restating the matcher's threshold", () => {
  // R2-F4: the first judge decoded "for the pair" and the second could not -- "I do not know what
  // '4 mana for the pair' is measuring". R2-F8: "cheap" invited a judgement the reader could not
  // make ("three of the five rows say 6 mana … I don't know whether 6 still counts as cheap"), so
  // the word is tied to the RULE rather than to their sense of it. `CHEAP_COMBO_MV` stays in the
  // matcher: a threshold copied into copy is a threshold that drifts.
  render(<BracketPanel bracket={{
    band: "4-5", gameChangers: [], infiniteCombos: 1,
    cheapCombos: [{ cards: ["Dualcaster Mage", "Ghostly Flicker"], result: "Infinite", manaValue: 6 }],
    reasons: [],
  }} />);
  expect(screen.getByTestId("bracket-combo")).toHaveTextContent("6 mana together");
  expect(screen.getByTestId("bracket-combo")).toHaveTextContent("early enough to rule out bracket 3");
});

test("a 4-5 deck with no cheap combo still says what put it there", () => {
  // `brackets.ts` reaches 4-5 either on a cheap combo or on more Game Changers than bracket 3
  // allows, and only the first had a sentence -- so a deck in the second case read its band with
  // nothing explaining it. Derived from the band and the empty list, never from the matcher's
  // ceiling constant.
  render(<BracketPanel bracket={{
    band: "4-5",
    gameChangers: ["Rhystic Study", "Mana Crypt", "Jeska's Will", "Fierce Guardianship"],
    infiniteCombos: 0,
    cheapCombos: [],
    reasons: [],
  }} />);
  expect(screen.getByText(/More Game Changers than bracket 3 allows/)).toBeInTheDocument();
});

// JOURNEY RULE 7: a deck-relative dial and a WotC band must not read as the same scale. `Bracket 4-5`
// shipped as a 24px `stat-num` one column from SYNERGY and BUILD, both genuinely out of five -- so
// the one number on the page that is NOT a score was the one wearing a score's clothes. Three cells
// cannot be read as "x out of 5"; a big numeral can.
test("the bracket draws as a three-cell band with the deck's own cell filled", () => {
  const { unmount } = render(<BracketPanel bracket={{
    band: "3", gameChangers: [], infiniteCombos: 1, cheapCombos: [], reasons: [],
  }} />);
  const cells = screen.getAllByTestId("bracket-cell");
  // THREE, AND STAYING THREE. Owner ruling 2026-09-01: "1 and 5 are player choice, the rest are
  // rules" -- a five-cell band asks the client to print a number nothing can check.
  expect(cells).toHaveLength(3);
  expect(cells.map((c) => c.textContent)).toEqual(["1–2", "3", "4–5"]);
  expect(cells.map((c) => c.getAttribute("data-here"))).toEqual([null, "1", null]);
  // A BAND REPORTS; A TAB STRIP INVITES. Three separately bordered, separately rounded cells with
  // one filled are built exactly like this app's own tab strip, and a judge read them that way --
  // "I can't tell whether the panel is reporting a result or offering me a choice". The radius and
  // the outer border belong to the TRACK, so no cell can wear a pill's shape.
  for (const cell of cells) expect(cell.className).not.toMatch(/rounded/);
  unmount();

  const high = render(<BracketPanel bracket={{
    band: "4-5", gameChangers: ["Rhystic Study"], infiniteCombos: 0, cheapCombos: [], reasons: [],
  }} />);
  expect(screen.getAllByTestId("bracket-cell").map((c) => c.getAttribute("data-here")))
    .toEqual([null, null, "1"]);
  high.unmount();
});

// THE EVIDENCE, AS PIPS, so the eye goes band -> why without reading. The named list underneath is
// what a reader CHECKS; this is what they see first.
test("the band carries one pip per piece of evidence that put the deck there", () => {
  const { unmount } = render(<BracketPanel bracket={{
    band: "4-5",
    gameChangers: ["Rhystic Study", "Mana Crypt"],
    infiniteCombos: 1,
    cheapCombos: [{ cards: ["Isochron Scepter", "Dramatic Reversal"], result: "Infinite untap", manaValue: 4 }],
    reasons: [],
  }} />);
  // Two Game Changers and ONE combo -- the cheap combo IS the infinite one. `brackets.ts` derives
  // `cheapCombos` by filtering `infinite`, so it is a subset by construction and adding both counts
  // every cheap combo twice. Measured on the example deck (S16): 1 Game Changer and 5 infinite
  // combos, all five cheap, painted ELEVEN pips over a list of six things, and a skeptic counted
  // the list and could not reconcile it.
  expect(screen.getAllByTestId("bracket-pip")).toHaveLength(3);
  // AND THEY CARRY A WORD. Bare pips carried nothing: a judge did not see them until asked, then
  // could not decode them -- "two marks, no legend, no text, I'd have to guess what they count".
  // S14 judge round, F4: "N things put it here" claimed all N forced this band, while the boxes
  // below said only some of them did -- the reader could not tell which. The count is what the
  // brackets LOOK AT; the boxes say what each one does.
  // R2: an abstract count is not accountable. "6 things the brackets look at" against two visible
  // boxes left a reader unable to find four of them -- the six ARE 1 + 5 and the addition was left
  // to them. The line does it out loud.
  expect(screen.getByText(/2 Game Changers, 1 infinite combo/)).toBeInTheDocument();
  // The box headings carry the same counts; this pins the SUMMARY line beside the dots, which is
  // the one that has to be decodable without reading the boxes.
  unmount();

  // THE SUBSET RULE, PINNED ON ITS OWN: five infinite combos that are all cheap are five things,
  // not ten. This is the shape the live deck had.
  const subset = render(<BracketPanel bracket={{
    band: "4-5",
    gameChangers: ["Jeska's Will"],
    infiniteCombos: 5,
    cheapCombos: Array.from({ length: 5 }, (_, i) => ({
      cards: ["Dualcaster Mage", `Flicker ${i}`], result: "Infinite", manaValue: 4,
    })),
    reasons: [],
  }} />);
  expect(screen.getAllByTestId("bracket-pip")).toHaveLength(6);
  expect(screen.getByText(/1 Game Changer, 5 infinite combos/)).toBeInTheDocument();
  subset.unmount();

  // Singular reads as a sentence, not as "1 things".
  const one = render(<BracketPanel bracket={{
    band: "3", gameChangers: ["Rhystic Study"], infiniteCombos: 0, cheapCombos: [], reasons: [],
  }} />);
  expect(screen.getAllByTestId("bracket-pip")).toHaveLength(1);
  // Two nodes carry it -- the summary beside the dots and the box heading. Both are correct;
  // the summary is the one being pinned, so the count is what is asserted.
  expect(screen.getByTestId("bracket-counts")).toHaveTextContent("1 Game Changer, no infinite combos");
  one.unmount();

  // A MARK THAT IS ALWAYS PRESENT MARKS NOTHING -- the same rule `DerivedMark` and the unread hatch
  // ship under. A 1-2 deck has no evidence and gets no pips; the panel states the absence in words.
  render(<BracketPanel bracket={{
    band: "1-2", gameChangers: [], infiniteCombos: 0, cheapCombos: [], reasons: [],
  }} />);
  expect(screen.queryAllByTestId("bracket-pip")).toHaveLength(0);
});

// I11's REPORT WIRING. This panel is where the model's refused quantities could leak into a headline,
// so the copy is asserted, not just the numbers: the range must be named as the PLAY POLICY and the
// colour blindness must be on screen rather than in a tooltip.
test("the mana panel shows a policy range, its spread, and says what it is not", () => {
  const rows = [1, 2, 3].map((turn) => ({
    turn,
    mana: { median: turn, p25: turn - 1, p75: turn + 1 },
    payableShare: { median: 0.5, p25: 0.4, p75: 0.6 },
  }));
  const { unmount } = render(<ManaAvailability manaAvailability={{
    trials: 2000, accelerants: 11, rows, headline: { mana: 6, turn: 6, low: 0.55, high: 0.62 },
  }} />);
  // BOTH ENDS WHERE THE POLICY DECIDES THE ANSWER, one number where it does not. The falsifier's
  // finding stands -- policy moves this cell -- and is narrowed to the 22 of 71 decks whose two arms
  // sit more than 8pp apart. Seven points is not one of them.
  expect(screen.getByText(/55%/)).toBeInTheDocument();
  expect(screen.queryByText(/55% – 62%/)).not.toBeInTheDocument();
  expect(screen.getByText(/to make 6 mana by turn 6/)).toBeInTheDocument();
  // AND THE WIDE DECK KEEPS BOTH ENDS. `iz-it-izzet` measures 30% - 67% at this cell, a 36pp spread
  // where the sequencing decides the answer and no single number can stand for it.
  unmount();
  render(<ManaAvailability manaAvailability={{
    trials: 2000, accelerants: 11, rows, headline: { mana: 6, turn: 6, low: 0.30, high: 0.67 },
  }} />);
  expect(screen.getByText(/30% – 67%/)).toBeInTheDocument();
  // C7: THE SPREAD TRAVELS WITH EVERY MEDIAN, and after T17 that happens on the chart rather than
  // in a table -- one <title> per plotted turn. This assertion kept passing across that change
  // because the fixture has three rows and the tooltips matched the same text the table cells used
  // to, which is a coincidence and not a check; it names the marks now.
  const spreads = document.querySelectorAll("svg title");
  expect([...spreads].filter((t) => /40%–60%/.test(t.textContent ?? ""))).toHaveLength(3);
  unmount();

  const { container } = render(<ManaAvailability manaAvailability={undefined} />);
  expect(container).toBeEmptyDOMElement();
});

// J4 + J12's pairing rule, wired to the web 2026-08-25. THE COPY IS THE ASSERTION, not just the
// findings: this panel sits above two real scores out of five, and a list of complaints with no
// caveat reads as a verdict. Silence must mean "nothing was FOUND", never "the deck is legal".
test("the legality panel reports and never gates, and says how many rules it checked", () => {
  const { unmount } = render(<LegalityPanel legality={[
    { rule: "size", detail: "34 cards, and a Commander deck is exactly 100", cards: [] },
    { rule: "pairing", detail: "these two cannot be commanders together", cards: ["Haunted One", "Krenko, Mob Boss"] },
  ]} />);
  expect(screen.getByText(/34 cards/)).toBeInTheDocument();
  expect(screen.getByText(/cannot be commanders together/)).toBeInTheDocument();
  expect(screen.getByText(/Haunted One/)).toBeInTheDocument();
  expect(screen.getByText(/report, not a verdict/i)).toBeInTheDocument();
  expect(screen.getByText(/nothing here stops the analysis/i)).toBeInTheDocument();
  expect(screen.getByText(/listed rather than passed/i)).toBeInTheDocument();
  unmount();

  // CAPPED AT EIGHT, as the CLI caps it — a colour-identity finding on a badly pasted deck can name
  // dozens, and a list that long stops being read.
  const many = render(<LegalityPanel legality={[{
    rule: "color-identity", detail: "11 cards are outside R", cards: Array.from({ length: 11 }, (_, i) => `Card ${i}`),
  }]} />);
  expect(screen.getByText(/and 3 more/)).toBeInTheDocument();
  expect(screen.queryByText("Card 10")).toBeNull();
  many.unmount();

  // A CLEAN RESULT NAMES WHAT WAS CHECKED (owner, 2026-09-22) -- silence read as "never checked" --
  // and still never says "legal", which five rules cannot claim. The banned list is named as unchecked.
  const clean = render(<LegalityPanel legality={[]} />);
  expect(screen.getByText(/Checked against Commander.s deck rules/)).toBeInTheDocument();
  expect(screen.getByText(/as of our card data/)).toBeInTheDocument();
  expect(clean.container.textContent).not.toMatch(/\blegal\b/i);
  expect(screen.queryByRole("heading")).toBeNull();
  clean.unmount();

  // TWO FINDINGS UNDER ONE RULE BOTH RENDER. The list was keyed on `rule`, so a companion outside
  // the identity AND short of its condition collided (React duplicate-key error in the browser).
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const two = render(<LegalityPanel legality={[
    { rule: "companion", detail: "Lurrus is outside your commander's colour identity", cards: [] },
    { rule: "companion", detail: "Lurrus's condition is not met", cards: [] },
  ]} />);
  expect(screen.getByText(/outside your commander/)).toBeInTheDocument();
  expect(screen.getByText(/condition is not met/)).toBeInTheDocument();
  expect(spy.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
  spy.mockRestore();
  two.unmount();

  // A companion is named where it is judged.
  const withCompanion = render(<LegalityPanel legality={[]} companions={["Lurrus of the Dream-Den"]} />);
  expect(screen.getByText(/Lurrus of the Dream-Den as your companion/)).toBeInTheDocument();
  withCompanion.unmount();

  // NO REPORT FIELD, NO CLAIM: an old report without `legality` renders nothing at all.
  const { container } = render(<LegalityPanel legality={undefined} />);
  expect(container).toBeEmptyDOMElement();
});

/** ONE PHYSICAL CARD, ONE TILE IN "Not read yet". A two-faced card rates one row per printed FACE
 *  (Task 7, faces-as-nodes) with `derived` identical on both, so an unread modal DFC drew two tiles
 *  and the count said "2 cards" directly under a caveat that counts SLOTS and says one. Review fix,
 *  2026-08-27: the same "2 of the 1 unread" defect the 08-27 wave fixed in `ReportView` and in
 *  `unjudgedCandidates`. The FRONT row survives, because the art map and the card drawer are both
 *  keyed on the face name. */
test("an unread two-faced card is one tile in Not read yet, not one per face", () => {
  const cards = [
    { name: "Fell the Profane", cardName: "Fell the Profane // Fell Mire", derived: false, synergyRating: 0, topPartners: [] },
    { name: "Fell Mire", cardName: "Fell the Profane // Fell Mire", face: 1, derived: false, synergyRating: 0, topPartners: [] },
    { name: "Sol Ring", derived: false, synergyRating: 0, topPartners: [] },
  ] as any;
  render(<CardList cards={cards} />);
  expect(screen.getByText("2 cards")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Fell the Profane" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Fell Mire" })).toBeNull();
});

/** A merged cut-list row names the PHYSICAL card ("you cannot cut half a card"), while every graph
 *  node's label is one printed FACE's name. Unjoined, `CardName` rendered those rows as plain text
 *  and the reader could not open the card the tool was telling them to cut. Review fix, 2026-08-28. */
test("a card named by the whole card, not by a face, still opens its front face", () => {
  const graph = {
    nodes: [
      { id: "A // B", label: "A", cardName: "A // B", types: [], subtypes: [], supertypes: [], colors: [], cmc: 1, copies: 1 },
      { id: "face:1:A // B", label: "B", face: 1, cardName: "A // B", types: [], subtypes: [], supertypes: [], colors: [], cmc: 1, copies: 1 },
    ],
    edges: [],
  } as any;
  render(
    <CardDrawerProvider graph={graph}>
      <CardName name="A // B" />
      <CardName name="Never in the deck" />
    </CardDrawerProvider>,
  );
  expect(screen.getByRole("button", { name: "A // B" })).toBeInTheDocument();
  // A name no node carries is still plain text: the drawer must not offer to open what it cannot.
  expect(screen.queryByRole("button", { name: "Never in the deck" })).toBeNull();
});

// Seven of the nine toggle groups in this client already say aria-pressed; these two did not, so
// the same widget announced its state in the graph controls and stayed silent in the report. A
// screen-reader user could hear "Ramp, button" with no way to know Ramp was the active filter.
// WCAG 4.1.2. Both directions are asserted so a regression to a static attribute also fails.
test("the card filter chips announce which one is active", async () => {
  // The chip row is built from the roles the cards actually carry, so the fixture has to name one.
  const cards = SAMPLE.report.cards.map((c, i) => (i === 0 ? { ...c, roles: ["ramp"] } : c)) as any;
  render(<CardList cards={cards} />);
  const all = screen.getByRole("button", { name: "All" });
  const ramp = screen.getByRole("button", { name: "Ramp" });
  expect(all).toHaveAttribute("aria-pressed", "true");
  expect(ramp).toHaveAttribute("aria-pressed", "false");

  await userEvent.click(ramp);
  expect(ramp).toHaveAttribute("aria-pressed", "true");
  expect(all).toHaveAttribute("aria-pressed", "false");
});


/** T19 (owner call 2026-09-02): *"LANDS IN YOUR OPENING 7 is right now hidden and to be honest this
 *  is important from the data point of view"*. The distribution was behind a `<details>`, so the
 *  eight bars existed and a reader had to know to look for them. The SENTENCE still leads -- one
 *  number is what a player acts on -- but the shape is no longer a click away. */
test("the opening-hand distribution renders without opening anything", () => {
  const { container } = render(<LandMathChart landCount={38} deckSize={99} />);
  expect(container.querySelector("details")).toBeNull();
  expect(screen.getByLabelText(/Lands in your opening seven, full distribution/)).toBeInTheDocument();
});

/** T21 (owner): *"why high synergy table is in the fix chapter? It does not make any sense"*. A list
 *  of what is WORKING is not a repair. It belongs with the chapter that asks what the deck is trying
 *  to do, beside the groups that say the same thing in aggregate. */
test("the high-synergy list sits in the plan chapter, not in the fix chapter", () => {
  const { container } = render(<MemoryRouter><ReportChapters data={SAMPLE} /></MemoryRouter>);
  const heading = screen.getByRole("heading", { name: "Cards that carry it" });
  const plan = container.querySelector("#plan");
  const fix = container.querySelector("#fix");
  expect(plan, "the plan chapter renders").not.toBeNull();
  expect(plan!.contains(heading)).toBe(true);
  expect(fix?.contains(heading) ?? false).toBe(false);
});

/** T16 (owner): *"THE CURVE BY MANA COST, NOT BY TURN when I click it components jump around and
 *  they should not"*. A CSS multi-column BALANCES its children across the columns, so a disclosure
 *  opening inside one changes the total height and every other panel is redistributed -- panels the
 *  reader was not looking at move. Outside the columns it can only push what is below it.
 *
 *  ASSERTED ON CONTAINMENT, not on a screenshot: the jump is a layout consequence and the only thing
 *  a DOM test can pin is the cause. */
test("the mana-cost disclosure sits outside the multi-column, so opening it cannot re-balance it", () => {
  const { container } = render(<MemoryRouter><ReportChapters data={SAMPLE} /></MemoryRouter>);
  const summary = screen.getByText(/the curve by mana cost, not by turn/);
  const details = summary.closest("details");
  expect(details).not.toBeNull();
  const columns = container.querySelector('[class*="columns-1"]');
  expect(columns, "the mana chapter still uses a multi-column").not.toBeNull();
  expect(columns!.contains(details!)).toBe(false);
});

/** T1: THE SAME TWENTY-WORD DISCLAIMER WAS IN FIVE PLACES. "a deckbuilding convention someone
 *  typed, not a number measured from any deck" appeared on the gauges' tick legend, the gauges'
 *  Explain, the cut list, the benchmarks caveat and every role finding — and repetition at that
 *  length is most of what makes a page read as machine-written.
 *
 *  THE CLAIM IS LOAD-BEARING AND IS NOT DELETED. It is stated in full ONCE, where the ticks it
 *  describes are first drawn, and everywhere else shortens to a pointer that still says where the
 *  number came from ("the template asks for 3"). This is the ratchet against it creeping back:
 *  a reader meets the long form once or the page is padding again. */
test("the tick line is said once, in one line, and the long disclaimers are gone", () => {
  const data = { ...SAMPLE, report: { ...SAMPLE.report, deckMath: DECK_MATH } };
  const { container } = render(<MemoryRouter><ReportChapters data={data} /></MemoryRouter>);
  const text = (container.textContent ?? "").replace(/\s+/g, " ");

  // The long form, once. Since 2026-09-06 the ticks are archetype medians and the long form says
  // what THAT number is ("what the themes run, not what they need"); the Command Zone wording
  // survives only for a report with no `template` at all. Either way: exactly one long form.
  const long = text.match(/a convention, not measured from real decks|what the archetypes? runs?, not what (?:it|they) needs?/g) ?? [];
  expect(long).toHaveLength(0);
  expect(text.match(/Ticks: /g) ?? []).toHaveLength(1);

  // And the phrasing it replaced is gone entirely -- "someone typed" was the tell.
  expect(text).not.toMatch(/someone typed/);
});

/** T17 (owner): *"mana availability is just a table with numbers, it can be presented better"*.
 *
 *  THE MANA COLUMN IS DELETED RATHER THAN CHARTED. `ManaTimeline`, in the same chapter and off the
 *  same `manaAvailability.rows`, already draws median mana per turn with the same p25-p75 band --
 *  drawing it again here would have been a third picture of one number. What was never drawn is the
 *  share of the deck this turn's mana can pay for. */
test("the mana panel charts the payable share and stops repeating the mana curve", () => {
  const rows = [1, 2, 3, 4].map((turn) => ({
    turn,
    mana: { median: turn, p25: turn - 1, p75: turn + 1 },
    payableShare: { median: turn / 10, p25: turn / 20, p75: turn / 8 },
  }));
  const { container } = render(<ManaAvailability manaAvailability={{
    trials: 2000, accelerants: 4, rows, headline: { mana: 6, turn: 6, low: 0.5, high: 0.6 },
  }} />);

  expect(container.querySelector("table")).toBeNull();
  // The figures stay reachable where there is no pointer: this IS the table view.
  const chart = screen.getByRole("img", { name: /Share of the deck payable, by turn/ });
  expect(chart.getAttribute("aria-label")).toMatch(/turn 4, 40% \(20% to 50%\)/);
  // One plotted point per row, and a turn label under each; the three axis ticks are not turns.
  expect(chart.querySelectorAll("circle")).toHaveLength(4);
  expect(chart.querySelectorAll("text:not([data-testid='y-tick'] text)")).toHaveLength(4);
});

/** T20 (owner): *"section like Does it play enough of each role? is ugly numbers and text and
 *  contradicts our dataviz rule"*. The leaf rows printed "12 · 86%" into a `flex-1` of empty space.
 *
 *  THE BAR AND THE PERCENTAGE ARE ONE VALUE RENDERED TWICE, which is the only safe way to show both
 *  -- so the pin is that they cannot disagree, not merely that a bar exists. */
test("a role leaf draws its share, at the width it prints", () => {
  const { container } = render(
    <BuildBenchmarks categories={SAMPLE.report.buildCategories} parents={SAMPLE.report.buildParents} />,
  );
  const rows = [...container.querySelectorAll("li[aria-label]")]
    .filter((li) => /\d+, \d+% of /.test(li.getAttribute("aria-label") ?? ""));
  expect(rows.length, "the fixture renders leaf rows").toBeGreaterThan(0);

  let withBar = 0;
  for (const li of rows) {
    const printed = /(\d+)% of /.exec(li.getAttribute("aria-label") ?? "")?.[1];
    const fill = li.querySelector<HTMLElement>("span[style*='width']");
    if (Number(printed) === 0) {
      // A zero-count leaf draws NO bar: a 4px stub would read as "some".
      expect(fill, li.getAttribute("aria-label") ?? "").toBeNull();
      continue;
    }
    expect(fill, li.getAttribute("aria-label") ?? "").not.toBeNull();
    expect(fill!.style.width).toBe(`${printed}%`);
    withBar++;
  }
  expect(withBar).toBeGreaterThan(0);
});


test("a hardest-to-cast row shows what the card costs", () => {
  const deckMath = {
    ...DECK_MATH,
    castability: {
      ...DECK_MATH.castability,
      cards: [{
        name: "Curse of Opulence",
        manaCost: "{R}",
        turn: 1,
        castable: { low: 0.42, high: 0.43 },
        mana: { low: 0.81, high: 0.81 },
      }],
    },
  };
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={deckMath as never} />);
  // THE COST IS THE SUBJECT of this panel: "42% to cast by turn 1" cannot be read without it.
  const row = screen.getByLabelText(/Curse of Opulence \{R\}/);
  expect(within(row).getAllByRole("img", { name: /mana/i }).length).toBeGreaterThan(0);
});

/** THE INLINE CARD NAME HAS A 24px HIT BOX WITHOUT MOVING ITS LINE (cohesion sweep 2026-09-08,
 *  finding 7). Padding and a matching negative margin are the whole mechanism; a later "tidy" that
 *  drops either one puts 81 sub-24px targets back on a phone report. */
test("CardName carries the padding-plus-negative-margin pair", () => {
  const { container } = render(<CardDrawerProvider graph={SAMPLE.graph}><CardName name={SAMPLE.graph.nodes[0]!.label} /></CardDrawerProvider>);
  const btn = container.querySelector("button")!;
  expect(btn.className).toContain("py-1");
  expect(btn.className).toContain("-my-1");
});

/** AN ARCHETYPE BAR IS DRAWN AGAINST THE WHOLE DECK (look-and-feel review, 2026-09-24). Scaled to
 *  the leader, a 17% archetype drew a full-width track and every seat read it as "all of it". */
test("an archetype bar's length is its share of the deck, not its share of the leader", () => {
  const strategies = [
    { name: "tokens", label: "Tokens", confidence: 0.17 },
    { name: "aristocrats", label: "Aristocrats", confidence: 0.12 },
  ] as never;
  const { container } = render(<ArchetypeBoard archetypes={SAMPLE.report.archetypes} strategies={strategies} />);
  const widths = [...container.querySelectorAll<HTMLElement>(".bg-\\(--fill\\)")].map((el) => el.style.width);
  expect(widths.slice(0, 2)).toEqual(["17%", "12%"]);
});

/** THE CARD-BY-THEME GRID WENT (owner, 2026-09-24); ITS ONE ACTIONABLE FACT CAME HERE. Cards no theme
 *  claims are named in the cut list, as a place to look -- not as cut candidates, which they are not. */
test("the cut list names the cards no theme claims, without calling them dead", () => {
  render(<CutList cuts={[]} slack={[]} offTheme={["Crib Swap", "Despark"]} />);
  expect(screen.getByText(/Fits no theme:/)).toBeInTheDocument();
  expect(screen.getByText("Crib Swap")).toBeInTheDocument();
  expect(screen.getByText(/unless they are removal or protection/)).toBeInTheDocument();
  expect(screen.queryByText("Nothing here is an easy cut.")).toBeNull();
});


// THE BRACKET WITH ITS WORKING SHOWN (owner, 2026-09-26). The baseline round's phone seat had
// "Bracket 3 · 1 infinite combo" and could not answer "which combo?"; the first-cuts seat saw 2 of
// "11 infinite combos" and wanted the rest so it would not cut half of one.
test("the bracket panel names every infinite combo, what it does, and says why in one sentence", () => {
  const mv: Record<string, number> = { "Dualcaster Mage": 3, "Ghostly Flicker": 3, "Essence Flux": 1, "Kiki-Jiki, Mirror Breaker": 5, "Zealous Conscripts": 5 };
  render(<BracketPanel
    bracket={{ band: "4-5", gameChangers: ["Jeska's Will"], infiniteCombos: 3,
      cheapCombos: [{ cards: ["Dualcaster Mage", "Essence Flux"], result: "Infinite ETB", manaValue: 4 }], reasons: [] }}
    combos={[
      { cards: ["Kiki-Jiki, Mirror Breaker", "Zealous Conscripts"], result: "Infinite hasty tokens" },
      { cards: ["Dualcaster Mage", "Essence Flux"], result: "Infinite ETB, Infinite storm count" },
      { cards: ["Dualcaster Mage", "Ghostly Flicker"], result: "Infinite ETB" },
      { cards: ["Sol Ring", "Arcane Signet"], result: "Mana" },
    ]}
    manaValueOf={(n) => mv[n]}
  />);
  expect(screen.getByTestId("bracket-why")).toHaveTextContent(
    "Bracket 4–5 because of Jeska's Will (a Game Changer) and 2 two-card infinite combos cheap enough to come together early (the cheapest Dualcaster Mage + Essence Flux, 4 mana).");
  const rows = screen.getAllByTestId("bracket-combo");
  // Only the infinite ones, cheapest and bracket-deciding first; the finite "Mana" pair is not one.
  expect(rows).toHaveLength(3);
  expect(rows[0]).toHaveTextContent(/Dualcaster Mage \+ Essence Flux/);
  expect(rows[0]).toHaveTextContent(/Infinite ETB · Infinite storm count/);
  expect(rows[0]).toHaveTextContent("early enough to rule out bracket 3");
  expect(rows[2]).toHaveTextContent(/Kiki-Jiki, Mirror Breaker \+ Zealous Conscripts/);
  expect(rows[2]).toHaveTextContent("10 mana together");
  expect(rows[2]).not.toHaveTextContent(/rule out bracket 3/);
});

test("a bracket 3 deck says which Game Changers it holds and that its combos are too costly to rule 3 out", () => {
  render(<BracketPanel
    bracket={{ band: "3", gameChangers: ["Rhystic Study", "Smothering Tithe"], infiniteCombos: 1, cheapCombos: [], reasons: [] }}
    combos={[{ cards: ["Kiki-Jiki, Mirror Breaker", "Zealous Conscripts"], result: "Infinite hasty tokens" }]}
    manaValueOf={() => 5}
  />);
  expect(screen.getByTestId("bracket-why")).toHaveTextContent(
    "Bracket 3 because of 2 Game Changers (Rhystic Study and Smothering Tithe) and Kiki-Jiki, Mirror Breaker + Zealous Conscripts (an infinite combo bracket 3 still allows: at 10 mana it comes together late).");
});

test("more than four combos fold behind Show all", () => {
  const combos = Array.from({ length: 6 }, (_, i) => ({ cards: [`A${i}`, `B${i}`], result: "Infinite mana" }));
  render(<BracketPanel bracket={{ band: "4-5", gameChangers: [], infiniteCombos: 6, cheapCombos: [], reasons: [] }} combos={combos} manaValueOf={() => 5} />);
  expect(screen.getAllByTestId("bracket-combo")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Show all 6" }));
  expect(screen.getAllByTestId("bracket-combo")).toHaveLength(6);
});

/** A NEW REPORT STARTS FROM ITS COMMANDER (owner, 2026-09-27: "with Rani deck I managed somehow to
 *  get Essence Flux as my starting point"). The chapters stay mounted from one deck to the next, so
 *  a card walked to on the last deck stayed the middle whenever the next deck also played it. */
test("the commander's orbit starts from the commander on a new report, whatever was walked to on the last", async () => {
  const { report, graph } = engineDeck();
  const data = (r: typeof report) => ({ ...SAMPLE, report: { ...SAMPLE.report, ...r }, graph }) as never;
  const user = userEvent.setup();
  const { rerender } = render(<MemoryRouter><ReportChapters data={data(report)} /></MemoryRouter>);
  const orbit = () => screen.getByRole("group", { name: / and the \d+ cards? it works with$/ });
  expect(orbit()).toHaveAccessibleName(/^Commander and/);
  // A first tap reads the pair, a second puts the card in the middle.
  await user.click(within(orbit()).getByRole("button", { name: "Payoff A" }));
  await user.click(within(orbit()).getByRole("button", { name: "Payoff A" }));
  expect(orbit()).toHaveAccessibleName(/^Payoff A and/);
  // The next deck also plays Payoff A.
  rerender(<MemoryRouter><ReportChapters data={data({ ...report })} /></MemoryRouter>);
  expect(orbit()).toHaveAccessibleName(/^Commander and/);
});
