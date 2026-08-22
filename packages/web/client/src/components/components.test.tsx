import { render, screen, fireEvent, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { DeckIdentity } from "./DeckIdentity.js";
import { ComboList } from "./ComboList.js";
import { MissingCards } from "./MissingCards.js";
import { OverviewTab } from "./OverviewTab.js";
import { ManaCurveChart } from "./ManaCurveChart.js";
import { LandMathChart } from "./LandMathChart.js";
import { ArchetypeBoard } from "./ArchetypeBoard.js";
import { CardList } from "./CardList.js";
import { CutList } from "./CutList.js";
import { ReportTabs } from "./ReportTabs.js";
import { HighSynergyCards } from "./HighSynergyCards.js";
import { HeadlineScores } from "./HeadlineScores.js";
import { BuildBenchmarks, demandSentence } from "./BuildBenchmarks.js";
import { SuggestionsList } from "./SuggestionsList.js";
import { SAMPLE } from "../fixtures.js";
import { RunDiffStrip } from "./RunDiffStrip.js";

test("DeckIdentity counts the deck's thing under the heading that names it", () => {
  render(<DeckIdentity cohesion={SAMPLE.report.cohesion} thing={{
    theme: "creatures entering", tag: "enters:creature", count: 39, cards: [],
    fromCommandZone: ["Samut, the Driving Force"], turn: 3, k: 2, probability: 0.96,
  }} />);
  expect(screen.getByText(/39 cards/)).toBeInTheDocument();
  expect(screen.getByText(/96% to have 2 of them by turn 3/)).toBeInTheDocument();
  // A command-zone member is available every game, so it is named beside the count and never
  // folded into a draw probability.
  expect(screen.getByText(/plus Samut, the Driving Force every game/)).toBeInTheDocument();
});

test("the commander's cast odds are a RANGE, and a refused cost is an em dash and never 0%", () => {
  const { rerender } = render(<DeckIdentity cohesion={SAMPLE.report.cohesion} commanderCast={[
    { name: "Samut, the Driving Force", turn: 6, mana: 0.341, manaWithRocks: 0.435, colors: [] },
  ]} />);
  expect(screen.getByText(/34–44% by turn 6/)).toBeInTheDocument();
  // ONE commander needs no name prefix; a partner pair does, or the two rows cannot be told apart.
  expect(screen.queryByText(/Samut, the Driving Force: /)).not.toBeInTheDocument();
  rerender(<DeckIdentity cohesion={SAMPLE.report.cohesion} commanderCast={[
    { name: "Omarthis", turn: 2, mana: null, manaWithRocks: null, colors: [], refused: "X cost — the mana value on the card is not what you pay" },
  ]} />);
  expect(screen.getByText(/— \(X cost/)).toBeInTheDocument();
  expect(screen.queryByText(/\b0%/)).not.toBeInTheDocument();
});

test("DeckIdentity shows the headline theme", () => {
  render(<DeckIdentity cohesion={SAMPLE.report.cohesion} />);
  expect(screen.getByText("Tokens")).toBeInTheDocument();
});

// A NAMING LAYER MAY DECLINE (roadmap A15). Under `THEME_NAME_FLOOR` the headline is carried by one
// or two cards -- `venser` reads 0.02 across the calibration corpus -- so the title says so and the
// tag drops to the subtitle rather than vanishing: it IS the deck's best-supported theme.
// THE HEADING IS THE ENGINE SLOT, so the sentence beneath it must not restate it -- a live browser
// showed "creatures dying" as the heading and "fueled by creatures dying (46% of nonlands)" one line
// below. Win route and means are what the heading does NOT already say.
test("DeckIdentity's sentence does not repeat the heading's own theme", () => {
  render(
    <DeckIdentity
      cohesion={SAMPLE.report.cohesion}
      identity={{ win: "wins by damage or drain (20 cards)", engine: "fueled by Tokens (46% of nonlands)", means: "18 interaction cards against a target of 10" }}
    />,
  );
  expect(screen.getByText(/wins by damage or drain/)).toBeTruthy();
  expect(screen.getByText(/18 interaction cards/)).toBeTruthy();
  expect(screen.queryByText(/fueled by/)).toBeNull();
});

test("DeckIdentity declines to name a deck whose theme is not dominant", () => {
  render(<DeckIdentity cohesion={{ ...SAMPLE.report.cohesion!, dominant: false, theme: "proliferate", score: 0.02 }} />);
  expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("No dominant theme");
  expect(screen.getByText(/strongest: proliferate/)).toBeTruthy();
});

// An ABSENT `dominant` is a caller that predates the field, never a negative opinion -- the CLI
// defaulting the other way made a 0.50-cohesion fixture abstain.
test("DeckIdentity names the deck when dominant is absent", () => {
  const { dominant: _drop, ...older } = SAMPLE.report.cohesion!;
  render(<DeckIdentity cohesion={older as typeof SAMPLE.report.cohesion} />);
  expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(SAMPLE.report.cohesion!.theme);
});

test("DeckIdentity renders nothing when there's no cohesion", () => {
  const { container } = render(<DeckIdentity cohesion={null} />);
  expect(container).toBeEmptyDOMElement();
});

const cohesionDraw = {
  theme: "Draw", // a functional role, deliberately NOT an archetype
  tag: "draw",
  secondary: null,
  secondaryTag: null,
  score: 0.4,
  label: "focused",
} as NonNullable<typeof SAMPLE.report.cohesion>;

// THE HEADLINE FLIPPED, 2026-08-20, and the test it replaces was right when it was written.
// `strategies[0]` led from 8de3c72 (2026-08-01) because a cohesion theme was then routinely a bare
// functional role -- `UNIFORM_STATS` collapsed the theme ranking to raw frequency and seven of
// eight decks themed "draw". That was fixed on 2026-08-18 (0c59087, 38e5248) and A1-A11 rebuilt the
// ranking on top of it; the guard outlived its defect, and on a wizard deck it printed "Tokens".
test("DeckIdentity headlines the cohesion theme, not the top archetype", () => {
  render(
    <DeckIdentity cohesion={cohesionDraw} strategies={[{ name: "tokens", label: "Tokens", confidence: 0.4 }]} />,
  );
  expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Draw");
  // The archetype survives as context, with its share -- not as the title.
  expect(screen.getByText(/signals Tokens 40%/)).toBeInTheDocument();
});

test("DeckIdentity prints the focus label with its share", () => {
  render(<DeckIdentity cohesion={cohesionDraw} strategies={undefined} />);
  expect(screen.getByText("focused · 0.40")).toBeInTheDocument();
});

// A10's rule: a SPECIFIC primary measures itself, so the family share is the difference between
// "this deck is broken" and "five Daleks inside a creature deck".
test("DeckIdentity shows the wider family only when it differs from the primary", () => {
  const narrow = { ...cohesionDraw, score: 0.08, familyScore: 0.46 };
  const { rerender } = render(<DeckIdentity cohesion={narrow} />);
  expect(screen.getByText(/wider family 0\.46/)).toBeInTheDocument();
  rerender(<DeckIdentity cohesion={{ ...cohesionDraw, familyScore: cohesionDraw.score }} />);
  expect(screen.queryByText(/wider family/)).not.toBeInTheDocument();
});

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
test("OverviewTab renders the deck identity, and avg mana value only where it is load-bearing", () => {
  render(<OverviewTab data={SAMPLE} />);
  expect(screen.getByText("Tokens")).toBeInTheDocument(); // DeckIdentity theme
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

test("ArchetypeBoard shows an empty-state message when there are no groups", () => {
  render(<ArchetypeBoard archetypes={[]} />);
  expect(screen.getByText(/No recognizable archetype patterns/)).toBeInTheDocument();
});

test("ArchetypeBoard shows the empty-state message when archetypes is undefined", () => {
  render(<ArchetypeBoard archetypes={undefined} />);
  expect(screen.getByText(/No recognizable archetype patterns/)).toBeInTheDocument();
});

test("Archetypes tab leads with ranked strategies", () => {
  render(<ArchetypeBoard
    strategies={[{ name: "tokens", label: "Tokens", confidence: 0.74 }] as any}
    archetypes={[]}
  />);
  expect(screen.getByText("Strategies")).toBeInTheDocument();
  expect(screen.getByText("Tokens")).toBeInTheDocument();
  expect(screen.getByText("74%")).toBeInTheDocument();
});

test("an expanded synergy group caps its pair list", () => {
  const pairs = Array.from({ length: 12 }, (_, i) => ({ a: `A${i}`, b: `B${i}`, reasons: [{ text: "r" }] }));
  render(<ArchetypeBoard strategies={[]} archetypes={[{ category: "x", label: "Group X", cards: Array(12).fill("c"), pairs } as any]} />);
  fireEvent.click(screen.getByText("Group X"));
  expect(screen.getByText(/\+4 more/)).toBeInTheDocument();
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
    manaValue: 7, castability: { turn: 7, mana: 0.22, manaWithRocks: 0.4, colors: [] },
  }] as any;
  render(<CardList cards={cards} />);
  const row = screen.getAllByRole("row").find((r) => r.textContent?.includes("Breach"))!;
  // Pins the actual symbol set "{5}{B}{B}" decodes to, not merely "some image rendered" -- a
  // dropped pip (e.g. only one black symbol) would still pass a bare non-empty check.
  expect(within(row).getAllByAltText(/mana/i).map((img) => img.getAttribute("alt"))).toEqual([
    "5 generic mana", "one black mana", "one black mana",
  ]);
  expect(within(row).getByText("22% – 40% by T7")).toBeInTheDocument();
  expect(within(row).getByText("3.7")).toBeInTheDocument();
});

/** The precon persona listed "{3}{B}{B} and the rest of the cost symbols" among words it could not
 *  understand. Brace notation must not survive anywhere in this table -- widened past a single
 *  colour letter, since a generic-mana token like "{3}" carries no letter at all. */
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
  expect(within(row).getByText("—")).toBeInTheDocument();
  expect(within(row).queryByText(/%/)).not.toBeInTheDocument();
});

test("Cards tab shows a card's functional role as a readable chip", () => {
  const cards = [{ name: "Sol Ring", roles: ["ramp"], synergyRating: 1.3, topPartners: [] }] as any;
  render(<CardList cards={cards} />);
  // Scope to the data row — with only one category present, "Ramp" also renders as
  // the filter chip, so an unscoped query would find two matches.
  const row = screen.getAllByRole("row").find((r) => r.textContent?.includes("Sol Ring"))!;
  expect(within(row).getByText("Ramp")).toBeInTheDocument();
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
  expect(screen.getAllByText("Stack interaction").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Burn & drain").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Stax").length).toBeGreaterThan(0);
});

test("Cards tab shows the top-partner reason under the card name", () => {
  const cards = [{ name: "Impact Tremors", roles: [], synergyRating: 3.0,
    topPartners: [{ name: "Krenko", reasons: [{ text: "Impact Tremors triggers on a creature entering; Krenko supplies it" }] }] }] as any;
  render(<CardList cards={cards} />);
  expect(screen.getByText(/triggers on a creature entering/)).toBeInTheDocument();
});

test("ReportTabs defaults to the Overview tab and switches on click", async () => {
  render(<ReportTabs data={SAMPLE} />);
  expect(screen.getByText("Tokens")).toBeInTheDocument(); // Overview's DeckIdentity theme, visible by default
  await userEvent.click(screen.getByRole("tab", { name: "Archetypes" }));
  expect(screen.getByText("Tokens Go Wide")).toBeInTheDocument(); // ArchetypeBoard content
  await userEvent.click(screen.getByRole("tab", { name: "Cards" }));
  expect(screen.getByText("Krenko, Mob Boss")).toBeInTheDocument(); // CardList content
  await userEvent.click(screen.getByRole("tab", { name: "Combos" }));
  expect(screen.getByText(/Infinite loop/)).toBeInTheDocument(); // ComboList content
});

// ART WARMS BEFORE THE GRAPH TAB IS EVER OPENED. `<GraphView>` is mounted by `active === "graph"`,
// so nothing requested an image until the user clicked Graph — and then ~95 discs queued at once,
// 75ms apart, while they waited. Every artCrop URL arrives with the analyze response and the user
// reads Overview for seconds first, so that time was being thrown away. Owner-reported: "why dont we
// start loading the images even before we land on the graph?".
test("ReportTabs starts fetching card art on the Overview tab, before Graph is opened", async () => {
  const fetchSpy = vi.fn((_url: unknown) => Promise.reject(new Error("no network in this test")));
  vi.stubGlobal("fetch", fetchSpy);
  const withArt = {
    ...SAMPLE,
    graph: {
      ...SAMPLE.graph,
      nodes: SAMPLE.graph.nodes.map((n, i) =>
        (i === 0 ? { ...n, artCrop: "https://cards.example/art_crop/a/b/c.jpg" } : n)),
    },
  };

  render(<ReportTabs data={withArt} />);

  // Never clicked Graph; the request is already out.
  expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
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
        (i === 0 ? { ...n, artCrop: "https://cards.example/art_crop/a/b/c.jpg" } : n)),
    },
  };

  render(<ReportTabs data={withArt} />);

  await vi.waitFor(() => {
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/normal/"))).toBe(true);
  }, { timeout: 3000 });
});

test("ReportTabs shows the unresolved banner outside the tab body, regardless of active tab", async () => {
  render(<ReportTabs data={SAMPLE} />);
  expect(screen.getByText(/Beholder's Death Ray/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "Cards" }));
  expect(screen.getByText(/Beholder's Death Ray/)).toBeInTheDocument(); // still visible
});

test("ReportTabs hides the unresolved banner when nothing is missing", () => {
  const noMissing = { ...SAMPLE, missing: [] };
  render(<ReportTabs data={noMissing} />);
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

test("HighSynergyCards shows the card's top reason text", () => {
  render(<HighSynergyCards cards={SAMPLE.report.cards} />);
  expect(screen.getAllByText("Krenko makes tokens; Impact Tremors pays off tokens.").length).toBeGreaterThan(0);
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
  expect(screen.getAllByText(/anchor/i).length).toBeGreaterThan(0); // ⚡ anchor marker
  expect(screen.getByText(/pulls double duty/i)).toBeInTheDocument(); // double-duty badge (Impact Tremors)
});

test("HeadlineScores shows SYNERGY and BUILD with band labels and sub-facets", () => {
  render(<HeadlineScores report={SAMPLE.report} />);
  // Exact, not a regex: both words now also occur inside the glosses that say what each tile
  // measures, and a loose match would find those instead of the labels.
  expect(screen.getByText("SYNERGY")).toBeInTheDocument();
  expect(screen.getByText("4.0")).toBeInTheDocument();      // synergyOverall
  expect(screen.getByText("BUILD")).toBeInTheDocument();
  expect(screen.getByText("3.7")).toBeInTheDocument();      // buildScore
  expect(screen.getAllByText(/Tuned|Focused/).length).toBeGreaterThan(0); // band labels (both tiles have one)
  // "breadth" now appears twice: the sub-facet line and the gloss that says what it measures.
  expect(screen.getAllByText(/breadth/i).length).toBeGreaterThan(0); // sub-facet
});

// THE BANDS WERE IN A `title` TOOLTIP, which does not exist on touch and is undiscoverable with a
// mouse — on the page's own lead figure. They are printed now, one click down, beside a gloss that
// says what the two halves of SYNERGY actually measure and which card the anchor is.
test("HeadlineScores explains its scale and names the anchor card", async () => {
  const user = userEvent.setup();
  render(<HeadlineScores report={SAMPLE.report} />);
  const gloss = screen.getAllByText("what this measures");
  expect(gloss).toHaveLength(2); // SYNERGY and BUILD each say what they mean
  await user.click(gloss[0]!);
  // Both tiles carry the band scale, so both copies are in the DOM; what matters is that it is
  // printed at all rather than hidden in a `title`.
  expect(screen.getAllByText(/0–1.5 unfocused/).length).toBe(2);
  expect(screen.getByText(/Krenko, Mob Boss/)).toBeInTheDocument(); // the deck's best-fed card
});

// TASK 7 (owner, 2026-08-21): a target now lives on the PARENT, and the shape below is the one
// this superseded — "benchmarks group under parents, and a parent shows no target of its own"
// (2026-08-20) asserted the exact opposite of what ships now. Kept only as history in the ledger;
// the live tests assert the new contract.
test("BuildBenchmarks renders a bar per PARENT, flags under-target; a leaf shows count and share, never a ratio", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} parents={SAMPLE.report.buildParents} />);
  expect(screen.getByText("Ramp")).toBeInTheDocument();
  expect(screen.getByText("6/10")).toBeInTheDocument();      // Ramp PARENT, under its own target
  expect(screen.getByText("14/10")).toBeInTheDocument();     // Consistency PARENT, over its own target
  // Tutors is a Consistency LEAF: it renders (owner's ruling: every leaf shows, including a zero),
  // but never as a "x/y" ratio -- only its count and share of Consistency's own total.
  expect(screen.getByText(/^Tutors$/)).toBeInTheDocument();
  const tutors = screen.getByText(/^Tutors$/).closest("li")!;
  expect(tutors.textContent).not.toMatch(/\d+\s*\/\s*\d+/);
  expect(tutors.textContent).toMatch(/0\s*·\s*0%/);
  // Only a PARENT carries the under-target flag.
  expect(screen.getByLabelText(/^Ramp 6 of 10, under target/i)).toBeInTheDocument();
});

test("a benchmark bar is read against a fixed target mark, so over-target does not paint as full", () => {
  const { container } = render(
    <BuildBenchmarks categories={SAMPLE.report.buildCategories} parents={SAMPLE.report.buildParents} />,
  );
  // The FILL specifically — a two-sided category also paints a satisfied band, and matching on
  // "any span with a width" would silently read that instead.
  const width = (label: RegExp): string =>
    (screen.getByLabelText(label).querySelector('[class*="bg-(--success)"], [class*="bg-(--warning)"]') as HTMLElement)
      .style.width;
  // The target sits at 70% of every track. Ramp 6/10 stops short of it, Consistency 14/10 runs
  // past it -- the old `min(1, count/target)` clamp painted BOTH at the same width as 4/4 and 1/1.
  expect(width(/^Ramp 6 of 10/i)).toBe("42%");
  expect(width(/^Consistency 14 of 10/i)).toBe("98%");
  // The mark itself is on screen once per PARENT row (leaf rows carry no target, so no mark) --
  // four parents in this fixture, none ungrouped.
  expect(container.querySelectorAll('span[style*="left: 70%"]').length).toBe(SAMPLE.report.buildParents!.length);
});

// A PARENT CARRIES ITS OWN TARGET NOW (owner, 2026-08-21, overriding the 2026-08-20 shape this
// test used to pin -- "a parent shows no target of its own"). A floor declared ONCE at the parent,
// with leaves showing only how the deck spent it, is a different object from the summed-leaves
// shape the spec refused, and it is what ships.
test("a parent DOES carry its own target and ratio; a leaf beneath it never restates one", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} parents={SAMPLE.report.buildParents} />);
  expect(screen.getByText("Consistency")).toBeInTheDocument();
  expect(screen.getByText("Interaction")).toBeInTheDocument();
  const consistency = screen.getByText("Consistency").closest("li")!;
  expect(consistency.textContent).toMatch(/14\s*\/\s*10/); // the PARENT's own ratio
  // Draw is a Consistency LEAF: count and share of the parent's own 14, never a "x/y" of its own.
  const draw = screen.getByText(/^Draw$/).closest("li")!;
  expect(draw.textContent).not.toMatch(/\d+\s*\/\s*\d+/);
  expect(draw.textContent).toMatch(/12\s*·\s*86%/); // 12 of Consistency's 14 = 86%
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

test("leaf shares total 100% even when a card fills two leaves, and the parent's own row says so", () => {
  render(<BuildBenchmarks categories={OVERLAP_CATEGORIES} parents={OVERLAP_PARENTS} />);
  // Divided by the LEAF SUM (9), never the parent's union (8): 6/9 = 67%, 3/9 = 33%. These total
  // 100% by construction -- 6/8 + 3/8 would have been 112%.
  expect(screen.getByLabelText(/^Draw 6, 67% of Consistency/)).toBeInTheDocument();
  expect(screen.getByLabelText(/^Card selection 3, 33% of Consistency/)).toBeInTheDocument();
  // The overlap is a REAL FACT ABOUT THE DECK, stated once on the parent row, rather than left for
  // a reader to notice the leaves summing past the parent's own count.
  expect(screen.getByLabelText(/^Consistency 8 of 10, under target; its leaves sum to 9/)).toBeInTheDocument();
});

// FIX F2 (controller review, 2026-08-21): `build.ts`'s own scoring loop skips a parent whose
// target is <= 0 outright ("neutral, unscored" -- `if (p.target <= 0) continue;`), but `bar()`'s
// fill was a bare `count / target` with no matching guard. Unreachable through today's
// `ARCHETYPE_TARGET_DELTAS` (nothing zeroes a parent's floor -- re-cutting those deltas is the
// owner's call, not this fix round's), but the day one does, a NONZERO count against a zero
// target divides to Infinity and a zero count against a zero target divides to NaN -- either
// paints a bar with a nonsense width. Mirrored here directly, the same "not scored, so not shown"
// treatment the `ungrouped` leaf filter already gives a zero-target leaf.
const ZERO_TARGET_CATEGORIES = [
  { category: "ramp", count: 6, target: 0 },
  { category: "boardWipe", count: 2, target: 0 },
] as unknown as typeof SAMPLE.report.buildCategories;
const ZERO_TARGET_PARENTS = [
  { name: "Ramp", count: 6, target: 10, leaves: ["ramp"] },
  // count > 0 against target 0 is deliberate -- it is the Infinity-producing case (2/0), the more
  // dangerous of the two since `Math.min(1, Infinity)` still used to read as a full-width bar.
  { name: "Board wipes", count: 2, target: 0, leaves: ["boardWipe"] },
] as unknown as typeof SAMPLE.report.buildParents;

test("a zero-target parent renders no bar at all, mirroring build.ts's own 'not scored' skip", () => {
  const { container } = render(
    <BuildBenchmarks categories={ZERO_TARGET_CATEGORIES} parents={ZERO_TARGET_PARENTS} />,
  );
  // The scored parent still renders normally.
  expect(screen.getByText("Ramp")).toBeInTheDocument();
  // The zero-target parent is entirely absent -- not present with a broken/NaN bar, absent outright,
  // the same treatment a zero-target LEAF already gets from the `ungrouped` filter above.
  expect(screen.queryByText("Board wipes")).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/^Board wipes/)).not.toBeInTheDocument();
  // No element anywhere carries a NaN- or Infinity-derived width.
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

test("every leaf still renders under exactly one parent", () => {
  const { container } = render(<BuildBenchmarks categories={SCRAMBLED_CATEGORIES} parents={SCRAMBLED_PARENTS} />);
  // DOM order follows BUILD_PARENTS, never the input array: Consistency's own leaves (draw, card
  // selection, tutor) before Ramp's, before Interaction's (removal, stack interaction, graveyard
  // hate, protection), before Board wipes' -- which the scrambled input above does not hold in
  // either order.
  //
  // EVERY PARENT NESTS ITS OWN `<h4>` NOW (Task 7 simplification -- there is no more single/multi
  // fold split, because every parent has a ratio of its own to show): its `<li>` (the `aria-label`)
  // therefore always precedes its own nested `<h4>` (the `textContent`) in document order. A
  // single-leaf parent (Ramp, Board wipes) stops there; a multi-leaf one is followed by its leaf
  // rows, each a count+share `<li>` with no nested heading of its own.
  const text = [...container.querySelectorAll("h4, li[aria-label]")]
    .map((el) => el.getAttribute("aria-label") ?? el.textContent);
  expect(text).toEqual([
    "Consistency 8 of 10, under target",
    "Consistency",
    expect.stringMatching(/^Draw 6, 75% of Consistency/),
    expect.stringMatching(/^Card selection 2, 25% of Consistency/),
    expect.stringMatching(/^Tutors 0, 0% of Consistency/), // absent from SCRAMBLED_CATEGORIES entirely -- still renders, at 0
    "Ramp 8 of 10, under target",
    "Ramp",
    "Interaction 4 of 10, under target",
    "Interaction",
    expect.stringMatching(/^Removal 3, 75% of Interaction/),
    expect.stringMatching(/^Stack interaction 0, 0% of Interaction/),
    expect.stringMatching(/^Graveyard hate 1, 25% of Interaction/),
    expect.stringMatching(/^Protection 0, 0% of Interaction/),
    "Board wipes 1 of 3, under target",
    "Board wipes",
  ]);
  // Grouping must not drop a PARENT's own ratio -- each parent row still carries its count/target.
  expect(screen.getByLabelText(/^Consistency 8 of 10/)).toBeInTheDocument();
  expect(screen.getByLabelText(/^Ramp 8 of 10/)).toBeInTheDocument();
  expect(screen.getByLabelText(/^Interaction 4 of 10/)).toBeInTheDocument();
  expect(screen.getByLabelText(/^Board wipes 1 of 3/)).toBeInTheDocument(); // CONFLICT 9's label survives
  // CONFLICT 8 (now unconditional, not a fold): a parent's name renders exactly once, nested inside
  // its own row's label span rather than duplicated by a leaf whose label happens to match it.
  expect(screen.getAllByText("Ramp")).toHaveLength(1);
  expect(screen.getAllByText("Board wipes")).toHaveLength(1);
  // The label slot must never be blank -- Task 7 keeps that guarantee for every parent, not only a
  // folded single-leaf one, since every parent now nests its `<h4>` in exactly this slot.
  //
  // ONE LEVEL DEEPER THAN BEFORE (whole-branch review MINOR 7): the `<li>`'s first child is now a
  // flex row `<div>` (the suffix note moved to its own line below it, so the row and the note no
  // longer fight over one line's width on a narrow viewport), and the label span sits inside THAT.
  const labelSlot = (label: RegExp) => screen.getByLabelText(label).firstElementChild?.firstElementChild;
  expect(labelSlot(/^Ramp 8 of 10/)?.textContent?.trim()).toBe("Ramp");
  expect(labelSlot(/^Board wipes 1 of 3/)?.textContent?.trim()).toBe("Board wipes");
  expect(labelSlot(/^Consistency 8 of 10/)?.textContent?.trim()).toBe("Consistency");
});

// Controller finding 1 (task 6 fix round): the score multiplies Interaction's count attainment by
// `answerCoverage.coverage`, so a row reading "11/10" (met on count alone) can still be the reason
// the headline is under 5. Live on `sarevok-lord-of-pain` the panel ticked Interaction while the
// score docked it by 0.816 -- nothing on screen explained the gap. Same defect class 7714d91
// rejected for the land count: a panel number the score does not use at face value must not render
// as if it does.
// `coverageWeighted: true` is required here (whole-branch review IMPORTANT 4): the row is now
// selected by that flag, not by `name === "Interaction"`, so a fixture missing it would silently
// stop exercising the coverage dock these tests exist to check.
const INTERACTION_MET_PARENTS = [
  { name: "Interaction", count: 11, target: 10, leaves: ["targetedRemoval", "stackInteraction", "graveyardHate", "protection"], coverageWeighted: true },
] as unknown as typeof SAMPLE.report.buildParents;

test("the Interaction row shows the coverage dock when coverage is under 1, even though the count alone is met", () => {
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      parents={INTERACTION_MET_PARENTS}
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
  expect(screen.getByText(/but answers 3 of 5 classes/i)).toBeInTheDocument();
  // Ratio and count still read as authored -- the dock is an EXPLANATION beside 11/10, not a
  // replacement of it.
  expect(screen.getByLabelText(/^Interaction 11 of 10/)).toBeInTheDocument();
  // The flag reads as NOT fully met, because it is not -- 11/10 * 0.816 < 1, same threshold the
  // score itself scores against. A tick here would be the exact defect being fixed.
  expect(screen.getByLabelText(/^Interaction 11 of 10, under target/)).toBeInTheDocument();
});

test("the Interaction row says nothing about coverage when it is fully covered", () => {
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      parents={INTERACTION_MET_PARENTS}
      answerCoverage={{ coverage: 1, source: "weighted", graveyardVulnerability: 0, rows: [] }}
    />,
  );
  expect(screen.queryByText(/but answers/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/^Interaction 11 of 10, on target/)).toBeInTheDocument();
});

test("the Interaction row says nothing about coverage when no answerCoverage was supplied", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} parents={INTERACTION_MET_PARENTS} />);
  expect(screen.queryByText(/but answers/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/^Interaction 11 of 10, on target/)).toBeInTheDocument();
});

// A non-Interaction parent is never coverage-weighted, even when it happens to be under-covered
// class-wise -- the multiplier only ever applies to Interaction (`build.ts`'s `coverageWeighted`).
test("a coverage dock never appears on a parent other than Interaction", () => {
  const ramp = [{ name: "Ramp", count: 6, target: 10, leaves: ["ramp"] }] as unknown as typeof SAMPLE.report.buildParents;
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      parents={ramp}
      answerCoverage={{ coverage: 0.5, source: "weighted", graveyardVulnerability: 0, rows: [] }}
    />,
  );
  expect(screen.queryByText(/but answers/i)).not.toBeInTheDocument();
});

// Whole-branch review IMPORTANT 4: the dock is selected by `p.coverageWeighted`, not by matching
// the parent's name, so it must survive a rename AND must not fire on a same-named row that lacks
// the flag -- both directions of the guarantee the flag exists to make.
test("the coverage dock follows the flag through a parent rename, not the name 'Interaction'", () => {
  const renamed = [
    { name: "Board control", count: 11, target: 10, leaves: ["targetedRemoval", "stackInteraction", "graveyardHate", "protection"], coverageWeighted: true },
  ] as unknown as typeof SAMPLE.report.buildParents;
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      parents={renamed}
      answerCoverage={{ coverage: 0.816, source: "weighted", graveyardVulnerability: 0, rows: [] }}
    />,
  );
  expect(screen.getByText(/but answers 0 of 0 classes/i)).toBeInTheDocument();
});

test("a parent named 'Interaction' without the flag gets no coverage dock", () => {
  const unflagged = [
    { name: "Interaction", count: 11, target: 10, leaves: ["targetedRemoval", "stackInteraction", "graveyardHate", "protection"] },
  ] as unknown as typeof SAMPLE.report.buildParents;
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      parents={unflagged}
      answerCoverage={{ coverage: 0.816, source: "weighted", graveyardVulnerability: 0, rows: [] }}
    />,
  );
  expect(screen.queryByText(/but answers/i)).not.toBeInTheDocument();
});

// Whole-branch review IMPORTANT 3: design §3's own promise -- "every poolShare is set to 1 and the
// panel says so" -- reached the wire (`answerCoverage.source`) and never reached the screen. An
// identity-less deck (no commander detected) is scored as though every colour could supply every
// class, and until this the panel said nothing about it.
test("the Interaction row admits the colour pool was unweighted when no commander was detected", () => {
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      parents={INTERACTION_MET_PARENTS}
      answerCoverage={{ coverage: 1, source: "unweighted", graveyardVulnerability: 0, rows: [] }}
    />,
  );
  expect(screen.getByText(/colour pool unweighted/i)).toBeInTheDocument();
  expect(screen.getByText(/no commander detected/i)).toBeInTheDocument();
  // Coverage is 1 here -- no docking note is owed, only the unweighted one.
  expect(screen.queryByText(/but answers/i)).not.toBeInTheDocument();
});

test("the Interaction row says nothing about the pool when a commander WAS detected", () => {
  render(
    <BuildBenchmarks
      categories={SAMPLE.report.buildCategories}
      parents={INTERACTION_MET_PARENTS}
      answerCoverage={{ coverage: 1, source: "weighted", graveyardVulnerability: 0, rows: [] }}
    />,
  );
  expect(screen.queryByText(/colour pool unweighted/i)).not.toBeInTheDocument();
});

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
      { class: "go-wide", count: 12, share: 0.6 },
      { class: "burn", count: 8, share: 0.4 },
    ],
    focus: 0.52,
    primary: "go-wide",
  },
  lands: { actual: 37, target: 34, targetSource: "derived" as const, rawTarget: 34, archetypeDelta: 0, avgManaValue: 2.7, rampPlusDraw: 12, fastMana: 2, mdfc: 0 },
  castability: {
    cards: [
      { name: "Ulamog", turn: 10, mana: 0.03, manaWithRocks: 0.11, colors: [] },
      { name: "Damnation", turn: 4, mana: 0.61, manaWithRocks: 0.78, colors: [{ color: "B", pips: 2, p: 0.74 }] },
    ],
    refused: 3,
    biases: "Ignores ramp, so it under-states; ignores tapped lands and colour coupling, so it over-states.",
  },
  colors: [
    { color: "B", supplied: 26, worst: { pips: 2, turn: 3, required: 33, cards: 12 } },
    { color: "U", supplied: 30 },
  ],
  demand: [
    { key: "enters:any", consumers: 20, suppliers: 84, available: 1, fromCommandZone: false },
    { key: "dies:any", consumers: 2, suppliers: 2, available: 0.227, fromCommandZone: false },
    { key: "attacks:any", consumers: 3, suppliers: 0, available: null, fromCommandZone: false },
  ],
};

test("deck-math blocks are grouped under the question they answer, worst section first", () => {
  // Scoped to `<section> > h4` -- T6's parent-category headings are h4 too (same rank, sibling
  // concern), and this test is about the four deck-math QUESTION sections specifically.
  const headings = (): string[] =>
    [...document.querySelectorAll("section > h4")].map((h) => h.textContent ?? "");

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

test("BuildBenchmarks shows answer coverage, including the classes the deck cannot answer", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.getByText(/answers by turn 5/i)).toBeInTheDocument();
  // A class with zero answers is the finding, so it must be a visible row rather than an omission.
  expect(screen.getByLabelText(/artifact, no answers/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/creature, 4 cards, 1 of them exile/i)).toBeInTheDocument();
  // A commander answer is available every game, and says why rather than just reading 100%.
  expect(screen.getByLabelText(/graveyard, 1 card, none recurring, always \(commander\)/i)).toBeInTheDocument();
});

test("an answer row says how many of its answers exile, and flags a graveyard row that never recurs", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  // 4 creature answers, 1 of which exiles -- the other 3 are undone by a reanimator.
  expect(screen.getByLabelText(/creature, 4 cards.*1 of them exile/i)).toBeInTheDocument();
  // The graveyard row's finding is the ZERO: it has hate, and none of it answers an engine. The row
  // still SAYS so to a screen reader; on screen it is promoted to a sentence, below.
  expect(screen.getByLabelText(/graveyard.*none recurring/i)).toBeInTheDocument();
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

test("BuildBenchmarks says how many answers short a class is, not just how likely it is", () => {
  // Step C. "41% by turn 5" tells you the odds and not what to do about them; the derived count
  // does. It is derived, not a template -- it moves with the deck's own clock.
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.getByLabelText(/creature, 4 cards, 1 of them exile, 2 short of 6/i)).toBeInTheDocument();
  // The probability it was derived from is NOT printed beside it: `available` is a pure function
  // of the count at a fixed library and turn, so the row would be saying one thing three times.
  expect(screen.queryByText("41%")).not.toBeInTheDocument();
  expect(screen.getByLabelText(/artifact, no answers, 6 short of 6/i)).toBeInTheDocument();
  // A commander answers every game, so a draw-probability shortfall would be a lie.
  expect(screen.getByLabelText(/graveyard, 1 card, none recurring, always \(commander\)/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/graveyard.*short/i)).not.toBeInTheDocument();
});

// Task 6: the coefficient discounts a colourless-pool zero on purpose; the panel is where that
// finding has to survive in words, since the score itself just reads as a smaller number.
test("BuildBenchmarks names the colour pool on a zero row, so the pie is not read as a mistake", () => {
  const withPool = {
    ...DECK_MATH,
    answers: DECK_MATH.answers.map((a) => (a.class === "artifact" ? { ...a, pool: 56 } : a)),
  };
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={withPool} />);
  expect(screen.getByText(/your colours offer 56/i)).toBeInTheDocument();
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

test("BuildBenchmarks shows demand against supply, and refuses a number where none applies", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  // The census key is engine vocabulary; the row says what the key MEANS and keeps the key on
  // `title` for anyone matching a report against `bin/deck-availability.ts`.
  expect(screen.getByLabelText(/anything dying, 2 cards want it, 2 supply it/i)).toBeInTheDocument();
  // No availability column: it is derived from the two counts beside it and reads 100% on every
  // row that has a supplier, which is a column with no variance.
  expect(screen.queryByText("23%")).not.toBeInTheDocument();
  expect(screen.getByTitle("dies:any")).toBeInTheDocument();
  // The game supplies a combat trigger: 0% would invent a hole, 100% would claim a board state
  // this layer does not model. And the VISIBLE row must not say "0 supply" either -- a zero next
  // to a dash reads as a hole in the deck.
  expect(screen.getByLabelText(/anything attacking, 3 cards want it, the game supplies it/i)).toBeInTheDocument();
  expect(screen.getByText(/3 want · the game supplies it/i)).toBeInTheDocument();
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
  expect(screen.getByLabelText(/clock turn 8, 6.4 expected power at turn 5/i)).toBeInTheDocument();
  // Optimistic by construction -- nobody blocks in this model -- and a turn number that does not
  // say so reads as a prediction rather than a rate.
  expect(screen.getByText(/nobody blocks/i)).toBeInTheDocument();
});

test("a deck with no combat clock says so rather than naming a turn", () => {
  const noClock = { ...DECK_MATH, clock: { powerAtFive: 0.4 } };
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={noClock} />);
  expect(screen.getByLabelText(/no combat clock/i)).toBeInTheDocument();
});

// THE BARS ARE A SENTENCE NOW. A share is what a bar says worst here -- the COUNTS are what
// separate "46% of a three-card plan" from "46% of a thirteen-card one" -- and the concentration
// figure needed a footnote apologising that its direction runs opposite to everything above it.
test("BuildBenchmarks names the win plans with their counts, and says which direction is good", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.getByLabelText(/win plans: go-wide 12 cards, burn 8 cards, focus 0\.52 of 1\.00/i)).toBeInTheDocument();
  expect(screen.getByText(/go-wide/)).toBeInTheDocument();
  expect(screen.getByText("12 cards")).toBeInTheDocument();
  // The concentration index has to say which DIRECTION is good, or a reader will assume more plans
  // is better -- it is the one number here scored the opposite way to the coverage above it.
  expect(screen.getByText(/Concentration 0\.52 of 1\.00/)).toBeInTheDocument();
  expect(screen.getByText(/Higher is better here/)).toBeInTheDocument();
});

test("BuildBenchmarks shows the land count the deck's own curve asks for", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  // Deck-derived, and now the SAME number buildScore is scored against (task 9) -- and it shows the
  // inputs, because "34" with no working is a number to argue with rather than act on.
  expect(screen.getByLabelText(/37 lands in the deck, this curve wants 34/i)).toBeInTheDocument();
  // The regression's author is implementation, not a label: the reader is asking how many lands
  // to run, not whose formula answered.
  expect(screen.queryByText(/karsten/i)).not.toBeInTheDocument();
  expect(screen.getByText(/avg mana value 2\.7/i)).toBeInTheDocument();
  expect(screen.getByText(/12 cheap ramp/i)).toBeInTheDocument();
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
    screen.getByLabelText(/37 lands in the deck, this curve wants 36 -- the flat convention, because this curve's own regression asks for 50, outside the tested range/i),
  ).toBeInTheDocument();
  expect(screen.getByText(/flat convention -- this curve's own regression asks for 50, outside the tested range/i)).toBeInTheDocument();
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
    screen.getByLabelText(/37 lands in the deck, this curve wants 43 -- 39 from the curve plus 4 because this is a landfall deck/i),
  ).toBeInTheDocument();
  expect(screen.getByText(/39 from the curve plus 4 because this is a landfall deck/i)).toBeInTheDocument();
  // Never the flat-convention wording on a purely-derived-plus-delta row.
  expect(screen.queryByText(/flat convention/i)).not.toBeInTheDocument();
});

test("BuildBenchmarks shows a colour that cannot pay its own pips on time", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  // The spec's own worked sentence: 12 cards want {B}{B} by T3, that needs 33 sources, you run 26.
  const bRow = screen.getByLabelText(/B, 26 sources, 12 cards want 2 pips by turn 3, which needs 33/i);
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

test("BuildBenchmarks shows the hardest casts on two axes, never one blended number", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  // A RANGE on the mana axis: lands-only under-states, lands-plus-rocks over-states, and a single
  // number would have to pick one of the two wrong ones.
  expect(screen.getByLabelText(/Ulamog, 3% – 11% to have 10 mana by turn 10/i)).toBeInTheDocument();
  // Mana and colour stay separate: "mana yes, colour no" is a different problem from its inverse,
  // and 61% x 74% would be both wrong and undiagnosable.
  expect(screen.getByLabelText(/Damnation, 61% – 78% to have 4 mana by turn 4, 74% for 2 B/i)).toBeInTheDocument();
  // The refusals are a count, not a silence: a card the model will not price must not read as a
  // card it priced at zero.
  expect(screen.getByText(/3 cards refused/i)).toBeInTheDocument();
  // THE DEADLINE IS ON SCREEN, not only in the aria-label. Four cards of equal mana value tie at
  // the same percentage by construction, and a bare "3% mana" repeated down the block was read as
  // a broken readout by three of four player reviews.
  expect(screen.getByText(/3% – 11% to have 10 mana by turn 10/i)).toBeInTheDocument();
});

/** Two land numbers reach one panel -- this regression's (an MDFC is a spell worth a fraction of a
 *  land) and the build category's (an MDFC is a land, by type line). Unexplained, that reads as a
 *  defect in the report, so the row says which it is counting. */
test("the land row explains an MDFC count, and says nothing when there is none", () => {
  const { unmount } = render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.queryByText(/modal DFC/i)).not.toBeInTheDocument();
  unmount();
  const withMdfc = { ...DECK_MATH, lands: { ...DECK_MATH.lands, mdfc: 4 } };
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={withMdfc} />);
  expect(screen.getByText(/4 modal DFCs counted as spells, not lands/i)).toBeInTheDocument();
});

test("BuildBenchmarks says where its turn came from, because it varies per deck", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  // "By turn 5" used to mean the same thing for every deck. Now it is this deck's own clock, and a
  // reader comparing two reports needs to know the horizon moved.
  expect(screen.getByText(/this deck's own clock/i)).toBeInTheDocument();
});

test("a deck with no clock says its turn is the corpus median", () => {
  const noClock = { ...DECK_MATH, turnSource: "corpus-median" as const, turn: 9, seen: 16, clock: { powerAtFive: 0.4 } };
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={noClock} />);
  expect(screen.getByText(/median of the calibration decks/i)).toBeInTheDocument();
});

test("BuildBenchmarks carries the caveat that makes the numbers readable", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  // Unweighted supply and no-opponent are not footnotes to look up later: without them a reader
  // takes 41% as a fact about their deck rather than about a hypergeometric draw.
  expect(screen.getByText(/unweighted/i)).toBeInTheDocument();
  expect(screen.getByText(/12 cards seen/i)).toBeInTheDocument();
});

test("BuildBenchmarks renders without deck math at all", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} parents={SAMPLE.report.buildParents} />);
  expect(screen.getByText("Ramp")).toBeInTheDocument();
  expect(screen.queryByText(/answers by turn/i)).not.toBeInTheDocument();
});

test("OverviewTab shows the health dashboard (headline, benchmarks, suggestions)", () => {
  render(<OverviewTab data={SAMPLE} />);
  expect(screen.getByText("SYNERGY")).toBeInTheDocument(); // HeadlineScores tile (exact, not "High synergy cards")
  expect(screen.getByText(/Build benchmarks/i)).toBeInTheDocument();
  expect(screen.getByText(/Suggestions/i)).toBeInTheDocument();
  expect(screen.getByText("Ramp")).toBeInTheDocument(); // BuildBenchmarks category
});

test("HeadlineScores uses semantic tokens, not raw Tailwind palette classes", () => {
  const { container } = render(<HeadlineScores report={{ synergyOverall: 1.2, buildScore: 1.0 } as any} />);
  expect(container.innerHTML).not.toMatch(/text-(red|amber|emerald)-\d{3}/);
});

test("SuggestionsList renders each suggestion; hidden when empty", () => {
  const { rerender } = render(<SuggestionsList suggestions={SAMPLE.report.suggestions} />);
  expect(screen.getByText("No board wipe (target 3), typically 3–5 mana")).toBeInTheDocument();
  rerender(<SuggestionsList suggestions={[]} />);
  expect(screen.queryByText(/board wipe/)).not.toBeInTheDocument();
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

// TRIM MODE is opt-in and client-side: the server ships the whole ranked order and N is a slice, so
// changing it must not need a round trip. It stays behind a click because a list that ALWAYS has an
// answer reads as a verdict when nobody asked for one.
const TRIM = [
  { name: "Dead Weight", rating: 0, partners: 0, manaValue: 2, reasons: ["nothing in the deck connects to it"], protections: [] },
  { name: "Sol Ring", rating: 0, partners: 0, manaValue: 1, reasons: ["nothing in the deck connects to it"],
    protections: ["fills ramp — ramp is at 16 against a target of 10, so there is room here"] },
  { name: "Third Card", rating: 0.4, partners: 1, manaValue: 3, reasons: ["only 1 card connects to it"], protections: ["fills draw"] },
];

test("trim rows stay hidden until asked for, then show N with what keeps each card", async () => {
  render(<CutList cutList={[]} slack={[]} trim={TRIM} />);
  expect(screen.queryByText("Dead Weight")).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "3" }));
  expect(screen.getByText("Dead Weight")).toBeTruthy();
  expect(screen.getByText("Third Card")).toBeTruthy();
  // The protection is rendered, not just the weakness — that is the whole difference from the cut
  // list, and it is what stops "cut Sol Ring" reading as a verdict.
  expect(screen.getByText(/ramp is at 16 against a target of 10/)).toBeTruthy();
  expect(screen.getByText(/nothing here ranks two ramp cards against each other/)).toBeTruthy();

  // Clicking the active count closes it again.
  await userEvent.click(screen.getByRole("button", { name: "3" }));
  expect(screen.queryByText("Dead Weight")).toBeNull();
});

test("trim renders even when the passive cut list is empty — the case it exists for", () => {
  render(<CutList cutList={[]} slack={[]} trim={TRIM} />);
  expect(screen.getByText(/Over on cards\?/)).toBeTruthy();
});

// F3: the slack chip printed the raw camelCase key ("targetedRemoval 14/10 (+4)") because this
// file had no label map at all -- BuildBenchmarks' fix for the identical bug (CONFLICT 9,
// `graveyardHate`) could not reach here, since its map was a local `const`. Both now import the
// same `BUILD_CATEGORY_LABEL`.
test("the slack chip names its category in words, not the raw camelCase key", () => {
  render(
    <CutList
      cutList={[]}
      slack={[{ category: "targetedRemoval", count: 14, target: 10, over: 4 }]}
      trim={[]}
    />,
  );
  expect(screen.getByText(/Removal/)).toBeInTheDocument();
  expect(screen.queryByText(/targetedRemoval/)).not.toBeInTheDocument();
});

// --- The card drawer (F8): the inspector, reachable from any card name in the report. ---

test("clicking a card name in the Cards table opens the inspector on that card", async () => {
  const user = userEvent.setup();
  render(<ReportTabs data={SAMPLE} />);
  await user.click(screen.getByRole("tab", { name: "Cards" }));
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
  render(<ReportTabs data={withStranger} />);
  await user.click(screen.getByRole("tab", { name: "Combos" }));
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
      { color: "U", supplied: 22, worst: { pips: 2, turn: 2, required: 36, cards: 1 } },
      { color: "B", supplied: 20, worst: { pips: 2, turn: 3, required: 33, cards: 2 } },
      { color: "R", supplied: 21, worst: { pips: 2, turn: 3, required: 33, cards: 1 } },
    ],
  };
  const { unmount } = render(
    <BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={overcommitted} />,
  );
  expect(screen.getByText(/want 102 sources from 34 lands, which no\s+deck can hold/)).toBeInTheDocument();
  expect(screen.getByText("22 of 36 sources")).toHaveClass("text-(--muted)");
  unmount();

  // And it still fires where the gap IS closable: one colour, wanting fewer sources than the deck
  // holds lands.
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.getByText("26 of 33 sources")).toHaveClass("text-(--warning)");
  expect(screen.queryByText(/which no\s+deck can hold/)).not.toBeInTheDocument();
});

// --- The run diff (F13): what your last edit did. ---

test("the run-diff strip names the cards, the moved scores and the moved categories", () => {
  render(
    <RunDiffStrip
      diff={{
        added: ["Arcane Signet"],
        removed: ["Mountain"],
        synergy: { from: 3.4, to: 3.9 },
        build: undefined,
        theme: undefined,
        categories: [{ category: "ramp", from: 6, to: 7 }],
      }}
    />,
  );
  expect(screen.getByText("Since your last run")).toBeInTheDocument();
  expect(screen.getByText("3.4 → 3.9")).toBeInTheDocument();
  expect(screen.getByText("(+0.5)", { exact: false })).toBeInTheDocument();
  expect(screen.getByText("6 → 7")).toBeInTheDocument();
  expect(screen.getByText("Arcane Signet")).toBeInTheDocument();
  expect(screen.getByText("Mountain")).toBeInTheDocument();
});

// Nothing to say renders NOTHING. A strip reading "no change" after a no-op re-analyse is the same
// noise the strip exists to remove.
test("the run-diff strip renders nothing without a diff", () => {
  const { container } = render(<RunDiffStrip diff={null} />);
  expect(container).toBeEmptyDOMElement();
});

// --- Overview weight (F12). ---

// THE CAVEATS SURVIVE WORD FOR WORD AND STOP COSTING A QUARTER OF THE PANEL. The horizon itself
// stays visible, because a reader who does not know the turn cannot read a single figure below it.
// Asserted on `open`, not on presence: jsdom renders a closed <details>'s children into the DOM, so
// a query for the text finds it either way -- what changes is whether a reader can see it.
test("the model's caveats fold away while the horizon they qualify stays visible", async () => {
  const user = userEvent.setup();
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.getByText(/Everything below is priced at turn 5/)).toBeInTheDocument();
  const caveat = screen.getByText(/Supply is unweighted/).closest("details")!;
  expect(caveat.open).toBe(false);
  await user.click(within(caveat).getByText("what this number ignores"));
  expect(caveat.open).toBe(true);
});

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
  expect(screen.getByText("1 want with nothing in the deck supplying it.")).toBeInTheDocument();
  // The unmet row leads OUTSIDE the expander, and the satisfied one appears only inside it.
  const folded = screen.getByText("all 2 wants").closest("details")!;
  expect(folded.open).toBe(false);
  expect(within(folded).getByText("20 want · 84 supply")).toBeInTheDocument();
  expect(screen.getAllByText("4 want · 0 supply")[0]).toHaveClass("text-(--warning)");
  expect(screen.queryAllByText("20 want · 84 supply")).toHaveLength(1);
  unmount();

  // A deck with nothing unmet says so in one line rather than listing rows that all agree.
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.getByText("Every want in this deck has something supplying it.")).toBeInTheDocument();
});

// --- The Cards table (F5). ---

// A RATING IS DECK-RELATIVE and the table never said so: 51 of 94 rows sit under 1.0 on a deck the
// same app rates 4.1 of 5, and a role card is silent BY DESIGN (`ROLE_NOT_SYNERGY`). Without the
// sentence, a reader takes Sol Ring at 0.3 as a verdict.
test("CardList says what the rating is measured against", () => {
  render(<CardList cards={SAMPLE.report.cards} />);
  expect(screen.getByText(/Rated against this deck's best synergy card/)).toBeInTheDocument();
  expect(screen.getByText(/score low by design/)).toBeInTheDocument();
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
  expect(screen.getByText(/counts lands only and under-states/)).toBeInTheDocument();
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
  expect(screen.getByText(/said once here/)).toBeInTheDocument();
  // SEVEN, not six: "Odd One" leads with the shared reason too — what makes it distinctive is the
  // SECOND reason it carries, which is exactly the row the fold has to keep.
  expect(screen.getByText("7").parentElement?.textContent).toMatch(/^7 × Wiz 0 triggers on a wizard entering/);
  // The shared sentence appears ONCE, in the note — not on the six rows that share it.
  expect(screen.getAllByText(/triggers on a wizard entering/)).toHaveLength(1);
  // And the row with something else to say keeps it.
  expect(screen.getByText("Odd One returns a creature from your graveyard")).toBeInTheDocument();
});
