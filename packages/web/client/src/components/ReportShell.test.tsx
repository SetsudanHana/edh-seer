import { render, screen, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { REFERENCE_SURFACES, ReportShell, SEED_CAP } from "./ReportShell.js";
import { ReportHeader } from "./ReportHeader.js";
import { ChapterRail, useCurrentChapter } from "./ChapterRail.js";
import { CHAPTERS } from "../lib/chapters.js";
import { findings } from "../lib/findings.js";
import { SAMPLE } from "../fixtures.js";
import type { RunDiff } from "../lib/run-diff.js";
import { CardDrawerProvider, usePinned } from "./card-drawer.js";

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--report-header-h");
});

/** `/cards` IS ABOUT TO MEAN SOMETHING ELSE. It becomes the site's card SEARCH page, so the report's
 *  three reference surfaces move under `/analysis` to get out of its way. Asserted on the exported
 *  table because `ChapterRail` renders from it and `SurfaceLink` navigates to it -- one list, three
 *  consumers, and a half-applied move would leave two of them pointing at a page that is no longer
 *  the report. */
test("the reference surfaces live under /analysis", () => {
  expect(REFERENCE_SURFACES.map((s) => s.path)).toEqual([
    "/analysis/graph",
    "/analysis/cards",
    "/analysis/combos",
  ]);
});

/** THE HEADER IS THE REPORT'S SUMMARY ON EVERY SURFACE — the split it resolves is that
 *  `HeadlineScores` lived inside one sub-tab and the coverage gate above the strip, so a reader on
 *  the graph had neither. */
test("the header carries both scores and the coverage figure, on every surface", async () => {
  // COVERAGE IS ABSENT ON A FULLY-READ DECK, by the same rule every other panel follows: the engine
  // computes the field only for a deck it could not read in full, so `SAMPLE` has none. Layered on
  // here rather than shipped in the fixture, exactly as the deck-math tests do.
  const partly = {
    ...SAMPLE,
    report: {
      ...SAMPLE.report,
      coverage: { derived: 1, resolved: 2, underivedNames: ["Impact Tremors"], more: 0, caveat: "half of it" },
    },
  } as typeof SAMPLE;
  render(<MemoryRouter><ReportShell data={partly} /></MemoryRouter>);
  const header = screen.getByRole("region", { name: "Deck summary" });
  expect(header).toHaveTextContent("Synergy");
  expect(header).toHaveTextContent("Build");
  // The figure, not the panel: `SAMPLE`'s coverage is 1 of 2 read.
  expect(header).toHaveTextContent(/\d+ of \d+ read/);

  await userEvent.click(screen.getAllByRole("link", { name: /^Cards/ })[0]!);
  expect(screen.getByRole("region", { name: "Deck summary" })).toHaveTextContent(/\d+ of \d+ read/);
});

/** EVERYTHING STICKY BELOW THE HEADER OFFSETS BY ITS MEASURED HEIGHT. R2 was the previous attempt
 *  at this offset — a hardcoded `top-[33px]` that hid the cards table's first row on a phone — so
 *  the variable existing is the fix, and its absence is the regression. */
test("the header writes its measured height into --report-header-h", () => {
  vi.stubGlobal("ResizeObserver", class {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
    unobserve() {}
    disconnect() {}
  });
  // The header routes to chapter 6 from a reference surface, so it reads the router's location.
  const { unmount } = render(<MemoryRouter><ReportHeader data={SAMPLE} /></MemoryRouter>);
  expect(document.documentElement.style.getPropertyValue("--report-header-h")).toMatch(/^\d+px$/);
  // AND IT IS CLEANED UP: a stale offset outlasting the report would push the entry screen's own
  // sticky content down by a header that is no longer on the page.
  unmount();
  expect(document.documentElement.style.getPropertyValue("--report-header-h")).toBe("");
});

/** THE ONE THING ROUTES WERE CHOSEN FOR. React Router changes the DOM without touching scroll, so
 *  without this a reader who opened the graph from chapter 5 came back to chapter 1. */
test("returning from a reference surface restores the scroll offset", async () => {
  const scrollTo = vi.fn();
  vi.stubGlobal("scrollTo", scrollTo);
  render(<MemoryRouter><ReportShell data={SAMPLE} /></MemoryRouter>);

  Object.defineProperty(window, "scrollY", { value: 2400, configurable: true });
  await userEvent.click(screen.getAllByRole("link", { name: /^Cards/ })[0]!);
  // A reference surface opens at ITS top; it is a new surface, not a continuation.
  expect(scrollTo).toHaveBeenCalledWith(0, 0);

  await userEvent.click(screen.getByRole("link", { name: /Report/ }));
  expect(scrollTo).toHaveBeenCalledWith(0, 2400);
});

/** A NEW ANALYSIS OPENS ON THE CHAPTERS. Without this a reader who left the graph open, edited
 *  their list and re-analysed came back to the graph — the one surface that answers none of the six
 *  questions a fresh report is for. */
test("a new report routes back to the chapters", async () => {
  const { rerender } = render(<MemoryRouter><ReportShell data={SAMPLE} /></MemoryRouter>);
  await userEvent.click(screen.getAllByRole("link", { name: /^Combos/ })[0]!);
  expect(screen.getByText(/Infinite loop/)).toBeInTheDocument();

  const second = { ...SAMPLE, report: { ...SAMPLE.report } };
  rerender(<MemoryRouter initialEntries={["/analysis/combos"]}><ReportShell data={second} /></MemoryRouter>);
  expect(screen.getByRole("navigation", { name: "Report chapters" })).toBeInTheDocument();
});

/** THE DIAGNOSIS IS ONE PRESS FROM ANYWHERE (roadmap S15). Chapter 6 sits ~7,000px down a
 *  9.6-screen report and both expert judges went straight to it; one built the deck's whole plan
 *  out of it rather than out of chapter 3. The narrative order stays for a first-time reader and
 *  the returning tuner stops paying for it.
 *
 *  The count comes from `findings`, which `Findings` itself calls -- so the header and the list
 *  cannot disagree about how many there are. */
test("the header carries the finding count, and reaches chapter 6 from a reference surface", async () => {
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  const expected = findings(SAMPLE.report).length;
  render(<MemoryRouter><ReportShell data={SAMPLE} /></MemoryRouter>);

  screen.getByRole("button", { name: new RegExp(`^${expected} finding`) });
  await userEvent.click(screen.getAllByRole("link", { name: /^Cards/ })[0]!);
  expect(document.getElementById("fix")).toBeNull(); // the chapters are not mounted here

  await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${expected} finding`) }));
  await vi.waitFor(() => expect(document.getElementById("fix")).not.toBeNull());
  // ON THE SECTION ITSELF, not on whatever happened to be scrolled. Measured on the live page:
  // scrolling one frame after the navigation ran before React had committed the chapters, so the
  // reader pressed "2 findings" and landed at the top of the report.
  await vi.waitFor(() => {
    expect(scrollIntoView.mock.instances).toContain(document.getElementById("fix"));
  });
});

/** A CHAPTER ANCHOR HAS TO CLEAR BOTH PINNED BARS. Below `lg` the rail is a second sticky strip
 *  under the header, and the first version of this offset counted only the header: a phone judge
 *  sent to chapter 6 read its heading as the single word "do?" -- the rest was behind the rail --
 *  and could not tell which chapter they were in. Both heights are measured; neither is a
 *  constant. */
test("each chapter's scroll offset clears the header and the rail", () => {
  render(<MemoryRouter><ReportShell data={SAMPLE} /></MemoryRouter>);
  for (const c of CHAPTERS) {
    const section = document.getElementById(c.id)!;
    expect(section.className, c.id).toContain("var(--report-header-h,0px)+var(--report-rail-h,0px)");
  }
});

/** THE DECK LIVES IN THE HASH, AND A SURFACE LINK MAY NOT DROP IT. Measured on the live page: a
 *  router `Link to="/analysis/cards"` replaced the whole location, so the URL became that path
 *  with no
 *  `#deck=` on it -- the report stayed on screen (it is in memory) while a reload or a copied link
 *  had lost the analysis. */
test("a reference link carries the deck hash into the new surface", async () => {
  window.location.hash = "#deck=abc123";
  render(<MemoryRouter><ReportShell data={SAMPLE} /></MemoryRouter>);
  const link = screen.getAllByRole("link", { name: /^Cards/ })[0]!;
  expect(link).toHaveAttribute("href", "/analysis/cards#deck=abc123");
  window.location.hash = "";
});

/** AND A CHAPTER LINK IS NOT AN ANCHOR AT ALL, for the same reason: `href="#stand"` REPLACES the
 *  deck payload in the hash. On the live page one click on the rail rewrote the URL to `/#stand`,
 *  which lost the decklist and made Back close the report. */
test("the rail's chapter links are buttons, not hash anchors", () => {
  render(<MemoryRouter><ReportShell data={SAMPLE} /></MemoryRouter>);
  const rail = screen.getByRole("navigation", { name: "Report chapters" });
  for (const c of CHAPTERS) {
    const control = within(rail).getByRole("button", { name: c.rail });
    expect(control.tagName).toBe("BUTTON");
  }
  expect(within(rail).queryByRole("link", { name: "Stand" })).toBeNull();
});

/** BELOW `lg` THE RAIL IS A SELECT, NOT A STRIP THAT SCROLLS SIDEWAYS.
 *
 *  Measured at 390 on the example deck: the strip's scrollport is 326px and the three reference
 *  surfaces, pinned to its right edge because they are the only route to their pages, hold 214 of
 *  it -- 66%. The six chapters scrolled through the remaining 112px, about two labels, sideways,
 *  while the page scrolled vertically under the same finger. Owner-reported: *"3 buttons are
 *  always visible and you have very small space to scroll the rest down."*
 *
 *  A native `<select>` is the platform's own answer: it always spells out the chapter you are in
 *  (the scroller could not -- it showed two of six), it opens the operating system's full-height
 *  picker showing all six at once, and it costs no sideways gesture. It also DELETES the edge
 *  fade, the `useClipped` measurement, the screen-reader overflow sentence and the effect that
 *  scrolled the strip to keep the marked chip on it -- none of which a select can need. */
function stubNarrow(): void {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: /max-width:\s*1023px/.test(q),
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  }));
}

test("below lg the chapters are a select naming the current one, and the surfaces keep their links", () => {
  stubNarrow();
  render(<MemoryRouter><ChapterRail current="roles" /></MemoryRouter>);
  const rail = screen.getByRole("navigation", { name: "Report chapters" });

  const select = within(rail).getByRole("combobox", { name: "Jump to chapter" });
  expect((select as HTMLSelectElement).value).toBe("roles");
  expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(
    CHAPTERS.map((c) => c.rail),
  );
  // The strip is gone, not merely restyled: no chip to scroll off an edge.
  for (const c of CHAPTERS) expect(within(rail).queryByRole("button", { name: c.rail })).toBeNull();
  expect(within(rail).queryByTestId("rail-edge-fade")).toBeNull();

  // The three that are the ONLY route to their surfaces stay visible, which is why they were
  // pinned in the first place.
  for (const label of ["Graph", "Cards", "Combos"]) {
    expect(within(rail).getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
  }
});

test("choosing a chapter in the select scrolls to that section", async () => {
  stubNarrow();
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  render(
    <MemoryRouter>
      <ChapterRail current="read" />
      {CHAPTERS.map((c) => <section key={c.id} id={c.id} />)}
    </MemoryRouter>,
  );
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Jump to chapter" }), "mana");
  expect(scrollIntoView.mock.instances).toContain(document.getElementById("mana"));
});

/** AND THE WHOLE BAR GETS OUT OF THE WAY WHILE YOU READ DOWN (owner-reported, 2026-09-03).
 *
 *  After the select the rail is 53px of an 844px phone, on top of the header's 73 -- 126px, 14.9%
 *  of the viewport, permanently spent on chrome while the reader is doing the one thing this page
 *  is for. Scrolling DOWN is the gesture that means "I am reading"; scrolling UP is the one that
 *  means "I want to get somewhere", and that is when the rail comes back.
 *
 *  jsdom lays nothing out and never scrolls, so `scrollY` is set by hand and the event dispatched:
 *  what is asserted is the RULE, which is the part that can be wrong. */
function atScroll(y: number): void {
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
}
function scrollTo(y: number): void {
  atScroll(y);
  act(() => { window.dispatchEvent(new Event("scroll")); });
}

test("the rail hides while you read down and comes back when you scroll up", () => {
  stubNarrow();
  // An earlier test in this file leaves `scrollY` at 2400, and the rail reads its starting point at
  // mount -- so every rail test says where the reader is BEFORE it renders one.
  atScroll(0);
  render(<MemoryRouter><ChapterRail current="read" /></MemoryRouter>);
  const rail = screen.getByRole("navigation", { name: "Report chapters" });
  expect(rail).not.toHaveAttribute("data-hidden");

  scrollTo(400);
  expect(rail).toHaveAttribute("data-hidden", "true");

  // A twitch is not a gesture: under the threshold nothing moves, which is what keeps the bar from
  // flickering on the wobble of a thumb.
  scrollTo(396);
  expect(rail).toHaveAttribute("data-hidden", "true");

  scrollTo(340);
  expect(rail).not.toHaveAttribute("data-hidden");

  // NEAR THE TOP IT IS ALWAYS THERE, whichever way the last gesture went -- the header and the rail
  // are one block at the top of the report and half of it arriving late reads as a glitch.
  scrollTo(600);
  expect(rail).toHaveAttribute("data-hidden", "true");
  scrollTo(40);
  expect(rail).not.toHaveAttribute("data-hidden");
});

/** A HIDDEN BAR IS STILL IN THE TAB ORDER, and a keyboard reader who tabs into a control parked
 *  behind the header has no idea where their focus went. Focus brings it back. */
test("focusing anything in the rail brings it back", () => {
  stubNarrow();
  atScroll(0);
  render(<MemoryRouter><ChapterRail current="read" /></MemoryRouter>);
  const rail = screen.getByRole("navigation", { name: "Report chapters" });
  scrollTo(400);
  expect(rail).toHaveAttribute("data-hidden", "true");

  act(() => { screen.getByRole("combobox", { name: "Jump to chapter" }).focus(); });
  expect(rail).not.toHaveAttribute("data-hidden");
});

/** AT `lg` THE RAIL IS A COLUMN BESIDE THE REPORT, costing no vertical space at all -- so there is
 *  nothing to reclaim and hiding it on scroll would only make the table of contents flicker. */
test("the rail never hides at lg, where it costs no vertical space", () => {
  atScroll(0);
  render(<MemoryRouter><ChapterRail current="read" /></MemoryRouter>);
  const rail = screen.getByRole("navigation", { name: "Report chapters" });
  scrollTo(400);
  expect(rail).not.toHaveAttribute("data-hidden");
});

/** THE RAIL REFLECTS POSITION — that is what makes it a table of contents rather than a second tab
 *  bar. jsdom lays nothing out, so the observer is driven by hand: what is asserted is the RULE
 *  (topmost intersecting chapter wins, in document order), which is the part that can be wrong. */
test("the rail marks the topmost visible chapter, in document order", () => {
  let fire: (entries: { target: { id: string }; isIntersecting: boolean }[]) => void = () => {};
  vi.stubGlobal("IntersectionObserver", class {
    constructor(cb: typeof fire) { fire = cb; }
    observe() {}
    disconnect() {}
  });
  function Harness() {
    return (
      <>
        <ChapterRail current={useCurrentChapter()} />
        {CHAPTERS.map((c) => <section key={c.id} id={c.id} />)}
      </>
    );
  }
  render(<MemoryRouter><Harness /></MemoryRouter>);

  // Two chapters intersect at once (a tall screen); the earlier one is the one you are reading.
  act(() => fire([
    { target: { id: "mana" }, isIntersecting: true },
    { target: { id: "roles" }, isIntersecting: true },
  ]));
  expect(screen.getByRole("button", { name: "Mana" })).toHaveAttribute("aria-current", "true");
  expect(screen.getByRole("button", { name: "Roles" })).not.toHaveAttribute("aria-current");

  // Scrolling past Mana promotes Roles rather than clearing the rail.
  act(() => fire([{ target: { id: "mana" }, isIntersecting: false }]));
  expect(screen.getByRole("button", { name: "Roles" })).toHaveAttribute("aria-current", "true");

  // AND A GAP BETWEEN TWO CHAPTERS' BANDS KEEPS THE LAST ANSWER, rather than blinking off.
  act(() => fire([{ target: { id: "roles" }, isIntersecting: false }]));
  expect(screen.getByRole("button", { name: "Roles" })).toHaveAttribute("aria-current", "true");
});

/** S8. A set the reader builds up over a 3,000px scroll is invisible unless something says how big
 *  it is, and the header is the one bar present in all six chapters. Absent at zero, because a mark
 *  that is always present marks nothing. The count travels to /cards -- a separate SURFACE, not a
 *  chapter anchor -- which is the one place a pinned card is lit AND named. */
test("the header says how many cards are pinned, and only when some are", async () => {
  function Pinner() {
    const { togglePin } = usePinned();
    return <button onClick={() => togglePin(SAMPLE.graph.nodes[0]!.label)}>pin it</button>;
  }
  render(
    <MemoryRouter>
      <CardDrawerProvider graph={SAMPLE.graph}>
        <ReportHeader data={SAMPLE} />
        <Pinner />
      </CardDrawerProvider>
    </MemoryRouter>,
  );
  expect(screen.queryByText(/pinned/)).toBeNull();

  await userEvent.click(screen.getByText("pin it"));
  const link = screen.getByRole("link", { name: /1 pinned/ });
  // The deck lives in the hash and a plain `<Link>` drops it; `SurfaceLink` is what carries it.
  expect(link.getAttribute("href")).toContain("/cards");

  await userEvent.click(screen.getByRole("button", { name: /clear pinned/i }));
  expect(screen.queryByText(/pinned/)).toBeNull();
});

/** THE SECOND RUN IS THE REAL PRODUCT (roadmap S9). `SAMPLE.report` carries synergy 4 and build 3.7,
 *  so both `HeaderScore`s render and both can take a delta. */
const runDiff: RunDiff = {
  added: ["Rhystic Study"],
  removed: [],
  synergy: { from: 3.7, to: 4 },
  build: { from: 3.9, to: 3.7 },
  categories: [],
  findings: [],
};

/** THE DELTA SITS BESIDE THE NUMBER IT QUALIFIES, on the line that is on screen at every scroll
 *  position and on every surface -- which is the whole of roadmap S9. */
test("the header prints a signed delta beside each score", () => {
  render(<MemoryRouter><ReportShell data={SAMPLE} diff={runDiff} /></MemoryRouter>);
  expect(screen.getByText("+0.3")).toBeInTheDocument();
  expect(screen.getByText("-0.2")).toBeInTheDocument();
});

/** WCAG 1.4.1: the direction is a sign, never a tone alone. */
test("a delta states its direction in text, not only in tone", () => {
  render(<MemoryRouter><ReportShell data={SAMPLE} diff={runDiff} /></MemoryRouter>);
  expect(screen.getByText("+0.3").textContent).toMatch(/^\+/);
});

test("run one prints no delta and no diff line", () => {
  render(<MemoryRouter><ReportShell data={SAMPLE} /></MemoryRouter>);
  expect(screen.queryByText(/^[+-]0\./)).toBeNull();
  expect(screen.queryByText("Since your edit")).toBeNull();
});

/** A 50%-overlap swap is still "the same deck" to `diffRuns`, so a 40-card edit would light most of
 *  the report -- and a mark that is always present marks nothing, the rule this header already
 *  follows in two places. */
test("a seed over the cap pins nothing", () => {
  const many = Array.from({ length: SEED_CAP + 1 }, (_, i) => `Card ${i}`);
  render(<MemoryRouter><ReportShell data={SAMPLE} diff={{ ...runDiff, added: many }} /></MemoryRouter>);
  expect(screen.queryByText(/pinned/)).toBeNull();
});

test("a seed within the cap pins the added cards", () => {
  render(<MemoryRouter><ReportShell data={SAMPLE} diff={runDiff} /></MemoryRouter>);
  // `physicalName` falls back to the name itself for a card the graph does not carry, so the count
  // is 1 whether or not the fixture's graph knows "Rhystic Study" -- which is the point: a seeded
  // name is a stable key, never a crash.
  expect(screen.getByText("1 pinned")).toBeInTheDocument();
});

/** Both media conditions `useBoardMode` reads, stubbed together -- `matchMedia` is the only input,
 *  and stubbing one query without the other silently answers `false` for the missing one. */
function stubPointer(coarse: boolean, anyFine: boolean, width: number) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("any-pointer: fine") ? anyFine : q.includes("pointer: coarse") ? coarse : false,
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("innerHeight", 844);
}

/** SAMPLE.graph is two nodes, which clears the disc floor on any screen -- the whole point of the
 *  constraint is that a small graph keeps the board. A phone test needs a graph big enough to fail
 *  it, so the nodes are padded out; the EDGES stay as they are, so Krenko is still the one card
 *  with a partner and therefore the one row that offers to open a board. */
function phoneSizedDeck() {
  const filler = Array.from({ length: 80 }, (_, i) => ({
    id: `Filler ${i}`, label: `Filler ${i}`, copies: 1,
    types: ["creature"], subtypes: [], supertypes: [], colors: ["R"], cmc: 2,
  }));
  return {
    ...SAMPLE,
    graph: { ...SAMPLE.graph, nodes: [...SAMPLE.graph.nodes, ...filler] },
  } as typeof SAMPLE;
}

// R1: on a thumb the Graph surface is the list, and the BOARD is one tap from a row -- not absent,
// which is what it has been since this surface was built. The phone judge tapped GRAPH, got a
// screen of chips, and read "board" as jargon for the card list.
/** NAVIGATED BY CLICKING, NOT BY `initialEntries`: the shell sends a fresh analysis to the chapters
 *  on mount, deliberately, so a route handed in at render time is navigated away from before a test
 *  can assert on it. Every other test in this file reaches a surface the same way. */
async function openGraph(data: typeof SAMPLE) {
  const user = userEvent.setup();
  render(<MemoryRouter><ReportShell data={data} /></MemoryRouter>);
  await user.click(screen.getAllByRole("link", { name: /^Graph/ })[0]!);
  return user;
}

test("a coarse pointer gets the list with the board reachable from a row", async () => {
  stubPointer(true, false, 390);
  await openGraph(phoneSizedDeck());
  expect(screen.getByLabelText("Find a card")).toBeInTheDocument();
  // The sentence that said the board "needs a wider screen" is false as of this change.
  expect(screen.queryByText(/needs a wider screen/i)).toBeNull();
  expect(screen.getAllByRole("button", { name: /see what it connects to/i }).length).toBeGreaterThan(0);
});

test("tapping a row opens that card's graph", async () => {
  stubPointer(true, false, 390);
  const user = await openGraph(phoneSizedDeck());
  await user.click(screen.getAllByRole("button", { name: /see what it connects to/i })[0]!);
  // `find`, not `get`, AND NOT ON THE DEFAULT BUDGET. The comment here used to say the ego board
  // "arrives one microtask after the tap", which stopped being true at #142 (`cae07fe`): EgoView
  // became a DYNAMIC IMPORT, so this waits on a module load, not on a microtask.
  //
  // `findByRole` allows 1000ms by default and a cold CI runner can miss it -- measured on PR #150,
  // where `test (node 20)` failed here alone, `test (node 22)` passed on the same commit, and a
  // rerun with no code change passed. That is the signature of a budget, not of a defect.
  //
  // 4000ms rather than a round 5000: vitest's own `testTimeout` default is 5000 and is not
  // configured in this package, so an assertion allowed the whole budget would race its own test
  // and report the timeout against the wrong thing. This is the ONLY test that reaches the board
  // through the router -- EgoView.test, GraphView.test and components.test import the views
  // directly and never cross the lazy boundary, so this is one site, not a pattern to sweep.
  expect(await screen.findByRole(
    "button", { name: /back to the card list/i }, { timeout: 4000 },
  )).toBeInTheDocument();
});

test("a precise pointer still gets the board", async () => {
  stubPointer(false, true, 1440);
  await openGraph(phoneSizedDeck());
  expect(screen.queryByRole("button", { name: /back to the card list/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /see what it connects to/i })).toBeNull();
});

/** A SHARED LINK TO A REFERENCE SURFACE STAYS ON IT (UX sweep 2026-09-06, D1). The "new report
 *  routes back to the chapters" effect also fired on the FIRST report, so `/analysis/combos#deck=…`
 *  opened, redirected to `/`, and dropped the hash on the way: a reload after that had no deck.
 *  Only a NEW report goes home, and the test above still proves that it does. */
test("the first report keeps the surface it arrived on", () => {
  render(<MemoryRouter initialEntries={["/analysis/combos"]}><ReportShell data={SAMPLE} /></MemoryRouter>);
  expect(screen.getByText(/Infinite loop/)).toBeInTheDocument();
});
