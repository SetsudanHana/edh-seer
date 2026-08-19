import { render, screen, fireEvent, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { DeckIdentity } from "./DeckIdentity.js";
import { ComboList } from "./ComboList.js";
import { MissingCards } from "./MissingCards.js";
import { StatTiles } from "./StatTiles.js";
import { OverviewTab } from "./OverviewTab.js";
import { ManaCurveChart } from "./ManaCurveChart.js";
import { LandMathChart } from "./LandMathChart.js";
import { ArchetypeBoard } from "./ArchetypeBoard.js";
import { CardList } from "./CardList.js";
import { ReportTabs } from "./ReportTabs.js";
import { HighSynergyCards } from "./HighSynergyCards.js";
import { HeadlineScores } from "./HeadlineScores.js";
import { BuildBenchmarks, demandSentence } from "./BuildBenchmarks.js";
import { SuggestionsList } from "./SuggestionsList.js";
import { SAMPLE } from "../fixtures.js";

test("DeckIdentity shows the headline theme", () => {
  render(<DeckIdentity cohesion={SAMPLE.report.cohesion} />);
  expect(screen.getByText("Tokens")).toBeInTheDocument();
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

test("DeckIdentity headlines the primary archetype, not the cohesion theme", () => {
  render(
    <DeckIdentity cohesion={cohesionDraw} strategies={[{ name: "tokens", label: "Tokens", confidence: 0.4 }]} />,
  );
  expect(screen.getByText("Tokens")).toBeInTheDocument(); // archetype headline
  expect(screen.queryByText("Draw")).not.toBeInTheDocument(); // functional role is NOT the headline
});

test("DeckIdentity falls back to the cohesion theme when there are no strategies", () => {
  render(<DeckIdentity cohesion={cohesionDraw} strategies={undefined} />);
  expect(screen.getByText("Draw")).toBeInTheDocument(); // fallback headline
});

test("ComboList shows the combo result", () => {
  render(<ComboList combos={SAMPLE.report.combos} />);
  expect(screen.getByText(/Infinite loop/)).toBeInTheDocument();
  expect(screen.getByText(/Phyrexian Altar/)).toBeInTheDocument();
});

test("ComboList section title uses the eyebrow convention, not a bold heading", () => {
  const { container } = render(<ComboList combos={[{ cards: ["A", "B"], results: ["X"] } as any]} />);
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

test("StatTiles shows avg CMC", () => {
  render(<StatTiles avgManaValue={2.7} />);
  expect(screen.getByText("2.7")).toBeInTheDocument();
  expect(screen.getByText("Avg CMC")).toBeInTheDocument();
});

test("Overview shows Avg CMC but not a standalone Lands stat tile", () => {
  render(<StatTiles avgManaValue={2.7} />);
  expect(screen.getByText("Avg CMC")).toBeInTheDocument();
  expect(screen.queryByText("Lands")).not.toBeInTheDocument();
});

test("OverviewTab renders deck identity and stat tiles from the full response", () => {
  render(<OverviewTab data={SAMPLE} />);
  expect(screen.getByText("Tokens")).toBeInTheDocument(); // DeckIdentity theme
  expect(screen.getByText("2.7")).toBeInTheDocument(); // avgManaValue stat tile
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

test("ArchetypeBoard shows a bar per group and expands to reveal pairs on click", async () => {
  render(<ArchetypeBoard archetypes={SAMPLE.report.archetypes} />);
  expect(screen.getByText("Tokens Go Wide")).toBeInTheDocument();
  expect(screen.getByText("2 cards")).toBeInTheDocument();
  // Pair detail is collapsed by default.
  expect(screen.queryByText(/Krenko, Mob Boss \+ Impact Tremors/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByText("Tokens Go Wide"));
  expect(screen.getByText(/Krenko, Mob Boss \+ Impact Tremors/)).toBeInTheDocument();
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
  expect(screen.getByText(/SYNERGY/i)).toBeInTheDocument();
  expect(screen.getByText("4.0")).toBeInTheDocument();      // synergyOverall
  expect(screen.getByText(/BUILD/i)).toBeInTheDocument();
  expect(screen.getByText("3.7")).toBeInTheDocument();      // buildScore
  expect(screen.getAllByText(/Tuned|Focused/).length).toBeGreaterThan(0); // band labels (both tiles have one)
  expect(screen.getByText(/breadth/i)).toBeInTheDocument(); // sub-facet
});

test("BuildBenchmarks renders a bar per category, flags under-target, omits zero-target", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} />);
  expect(screen.getByText("Ramp")).toBeInTheDocument();
  expect(screen.getByText("6/10")).toBeInTheDocument();      // under target
  expect(screen.getByText("14/10")).toBeInTheDocument();     // over target (draw)
  expect(screen.queryByText("Tutors")).not.toBeInTheDocument(); // tutor target 0 → omitted
  // under-target rows expose an accessible flag
  expect(screen.getByLabelText(/Ramp 6 of 10, under target/i)).toBeInTheDocument();
});

test("a benchmark bar is read against a fixed target mark, so over-target does not paint as full", () => {
  const { container } = render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} />);
  // The FILL specifically — a two-sided category also paints a satisfied band, and matching on
  // "any span with a width" would silently read that instead.
  const width = (label: RegExp): string =>
    (screen.getByLabelText(label).querySelector('[class*="bg-(--success)"], [class*="bg-(--warning)"]') as HTMLElement)
      .style.width;
  // The target sits at 70% of every track. 6/10 stops short of it, 14/10 runs past it -- the old
  // `min(1, count/target)` clamp painted BOTH at the same width as 4/4 and 1/1.
  expect(width(/Ramp 6 of 10/i)).toBe("42%");
  expect(width(/Draw 14 of 10/i)).toBe("98%");
  // And the mark itself is on screen, once per row, or the widths above compare against nothing.
  expect(container.querySelectorAll('span[style*="left: 70%"]').length).toBe(
    container.querySelectorAll("li[aria-label]").length,
  );
});

const DECK_MATH = {
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
  lands: { actual: 37, target: 34, avgManaValue: 2.7, rampPlusDraw: 12, fastMana: 2, mdfc: 0 },
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
  const headings = (): string[] =>
    [...document.querySelectorAll("h4")].map((h) => h.textContent ?? "");

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
  // The graveyard row's finding is the ZERO: it has hate, and none of it answers an engine.
  expect(screen.getByLabelText(/graveyard.*none recurring/i)).toBeInTheDocument();
  // A class with nothing to say says nothing -- no "0 of them exile" noise on an empty row.
  expect(screen.queryByLabelText(/artifact, no answers.*exile/i)).not.toBeInTheDocument();
  // Spelled out on screen, not abbreviated: `0 ex` / `0 rec` were the two most-misread strings on
  // this panel, including by a reader who guessed "exile" correctly and still called it broken.
  expect(screen.getByText("none recurring")).toBeInTheDocument();
  expect(screen.getByText("1 exile")).toBeInTheDocument();
  expect(screen.queryByText(/\bex\b/)).not.toBeInTheDocument();
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
  // An unknown verb is NOT dressed up in a phrase it never earned: the key survives verbatim.
  expect(demandSentence("bushido:type:creature")).toBe("bushido:type:creature");
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

test("BuildBenchmarks shows the win plans, scored on concentration not breadth", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.getByLabelText(/go-wide, 12 cards, 60% of the deck's win plan/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/burn, 8 cards, 40% of the deck's win plan/i)).toBeInTheDocument();
  // The focus index has to say which DIRECTION is good, or a reader will assume more plans is
  // better -- it is the one number here scored the opposite way to the coverage above it.
  expect(screen.getByText(/focus 0\.52/i)).toBeInTheDocument();
  expect(screen.getByText(/concentration/i)).toBeInTheDocument();
});

test("BuildBenchmarks shows the land count the deck's own curve asks for", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  // Deck-derived, unlike the flat 36 the benchmark above scores against -- and it shows the inputs,
  // because "34" with no working is a number to argue with rather than act on.
  expect(screen.getByLabelText(/37 lands in the deck, this curve wants 34/i)).toBeInTheDocument();
  // The regression's author is implementation, not a label: the reader is asking how many lands
  // to run, not whose formula answered.
  expect(screen.queryByText(/karsten/i)).not.toBeInTheDocument();
  expect(screen.getByText(/avg mana value 2\.7/i)).toBeInTheDocument();
  expect(screen.getByText(/12 cheap ramp/i)).toBeInTheDocument();
  expect(screen.getByText(/2 fast mana/i)).toBeInTheDocument();
});

test("BuildBenchmarks shows a colour that cannot pay its own pips on time", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  // The spec's own worked sentence: 12 cards want {B}{B} by T3, that needs 33 sources, you run 26.
  expect(screen.getByLabelText(/B, 26 sources, 12 cards want 2 pips by turn 3, which needs 33/i))
    .toBeInTheDocument();
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
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} />);
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
  expect(screen.getByText("No board wipe (target 3)")).toBeInTheDocument();
  rerender(<SuggestionsList suggestions={[]} />);
  expect(screen.queryByText(/board wipe/)).not.toBeInTheDocument();
});
