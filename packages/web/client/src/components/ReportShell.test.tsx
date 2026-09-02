import { render, screen, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { ReportShell, SEED_CAP } from "./ReportShell.js";
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
  rerender(<MemoryRouter initialEntries={["/combos"]}><ReportShell data={second} /></MemoryRouter>);
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
 *  router `Link to="/cards"` replaced the whole location, so the URL became `/cards` with no
 *  `#deck=` on it -- the report stayed on screen (it is in memory) while a reload or a copied link
 *  had lost the analysis. */
test("a reference link carries the deck hash into the new surface", async () => {
  window.location.hash = "#deck=abc123";
  render(<MemoryRouter><ReportShell data={SAMPLE} /></MemoryRouter>);
  const link = screen.getAllByRole("link", { name: /^Cards/ })[0]!;
  expect(link).toHaveAttribute("href", "/cards#deck=abc123");
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

/** A HIDDEN OVERFLOW NEEDS A VISIBLE CUE, and a cue for an overflow that is not there is the same
 *  lie pointing the other way -- so the rail's fade is driven by the measured width, exactly as the
 *  theme matrix's is (they share `useClipped`). jsdom reports every width as 0, so the widths are
 *  stubbed: what is asserted is that the cue follows the measurement. */
test("the rail shows an edge cue only when its labels are actually cut off", () => {
  const widths = { scrollWidth: 900, clientWidth: 390 };
  Object.defineProperty(HTMLUListElement.prototype, "scrollWidth", { configurable: true, get() { return widths.scrollWidth; } });
  Object.defineProperty(HTMLUListElement.prototype, "clientWidth", { configurable: true, get() { return widths.clientWidth; } });
  const { unmount } = render(<MemoryRouter><ChapterRail current={null} /></MemoryRouter>);
  expect(screen.getByTestId("rail-edge-fade")).toBeInTheDocument();
  unmount();

  widths.scrollWidth = 390;
  render(<MemoryRouter><ChapterRail current={null} /></MemoryRouter>);
  expect(screen.queryByTestId("rail-edge-fade")).toBeNull();

  Reflect.deleteProperty(HTMLUListElement.prototype, "scrollWidth");
  Reflect.deleteProperty(HTMLUListElement.prototype, "clientWidth");
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
