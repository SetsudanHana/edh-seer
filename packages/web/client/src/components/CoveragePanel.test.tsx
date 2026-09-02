import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { CoveragePanel } from "./CoveragePanel.js";
import { CardDrawerProvider } from "./card-drawer.js";

const show = (coverage: Parameters<typeof CoveragePanel>[0]["coverage"]) =>
  render(<CardDrawerProvider><CoveragePanel coverage={coverage} /></CardDrawerProvider>);

describe("CoveragePanel", () => {
  test("renders nothing when the engine read the whole deck", () => {
    const { container } = show(undefined);
    expect(container).toBeEmptyDOMElement();
  });

  test("prints the report's own sentence rather than composing a second copy", () => {
    // Two copies of a claim is how two surfaces start disagreeing — measured twice in this repo
    // (N6's number format, DeckIdentity's stale caveat), so the sentence ships as data.
    show({ resolved: 100, derived: 52, underivedNames: ["Ash Barrens"], more: 40, caveat: "48 cards of 100 are not in the read corpus yet." });
    // A substring matcher, because the paragraph also carries the ° legend — the one thing this
    // SURFACE contributes that the engine has no view on. The assertion is unchanged in intent:
    // the claim itself is the report's words, not a paraphrase.
    expect(screen.getByText(/48 cards of 100 are not in the read corpus yet\./)).toBeTruthy();
    expect(screen.getByText(/and 40 more/)).toBeTruthy();
    // …and the claim appears ONCE. The first cut restated its opening clause in the names line four
    // inches away, which is the drift this component's own header warns about.
    expect(screen.queryAllByText(/not in the read corpus yet/)).toHaveLength(1);
    expect(screen.getByText("52")).toBeTruthy();
  });
});

/** THE THREE DEFECTS THE 2026-08-27 PERSONA RUN FOUND IN THIS PANEL, pinned. */
describe("CoveragePanel — persona-run fixes", () => {
  const coverage = {
    resolved: 100, derived: 52, underivedNames: ["Ash Barrens"], more: 40,
    caveat: "48 cards of 100 are not in the read corpus yet.",
  };

  test("the resolved count rides here, so the page has ONE answer to 'did you understand my deck'", () => {
    // "52 of 100 cards read" over "Resolved 100/100" — two counters, two meanings, the same
    // denominator, four inches apart. Three of four personas stopped on the pair.
    render(<CardDrawerProvider><CoveragePanel coverage={coverage} resolved={100} total={100} /></CardDrawerProvider>);
    expect(screen.getByText(/100 of 100 cards matched a name/)).toBeTruthy();
  });

  // S12: the resolution counter said "lines" while `DeckInput` said "lines" about a different
  // quantity -- text lines of the paste, 87 against this 100. This counts CARD SLOTS, so it says
  // cards; the word is the fix and a regression here is a word, which is why it is pinned.
  test("the resolution counter never says 'lines' -- it counts card slots", () => {
    render(<CardDrawerProvider><CoveragePanel coverage={coverage} resolved={95} total={100} /></CardDrawerProvider>);
    expect(screen.queryByText(/lines/)).toBeNull();
    // And no unconditional "all" in front of a partial count.
    expect(screen.getByText(/95 of 100 cards matched a name/).textContent).not.toMatch(/all/);
  });

  test("an unread COMMANDER is named outright, never left inside 'and 40 more'", () => {
    render(
      <CardDrawerProvider>
        <CoveragePanel coverage={coverage} commanderUnread={["Nalia de'Arnise"]} />
      </CardDrawerProvider>,
    );
    expect(screen.getByText(/Your commander is one of them/)).toBeTruthy();
    expect(screen.getByText(/Nalia/)).toBeTruthy();
    expect(screen.getByText(/computed without it/)).toBeTruthy();
  });

  test("no commander callout when the engine read them", () => {
    render(<CardDrawerProvider><CoveragePanel coverage={coverage} commanderUnread={[]} /></CardDrawerProvider>);
    expect(screen.queryByText(/Your commander/)).toBeNull();
  });
});
