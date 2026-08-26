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
    expect(screen.getByText("48 cards of 100 are not in the read corpus yet.")).toBeTruthy();
    expect(screen.getByText(/and 40 more/)).toBeTruthy();
  });
});
