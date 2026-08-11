import { render, screen, fireEvent, within } from "@testing-library/react";
import { expect, test } from "vitest";
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
import { BuildBenchmarks } from "./BuildBenchmarks.js";
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

const DECK_MATH = {
  turn: 5,
  seen: 12,
  library: 99,
  answers: [
    { class: "creature", count: 4, fromCommandZone: false, available: 0.409 },
    { class: "artifact", count: 0, fromCommandZone: false, available: 0 },
    { class: "graveyard", count: 1, fromCommandZone: true, available: 1 },
  ],
  demand: [
    { key: "enters:any", consumers: 20, suppliers: 84, available: 1, fromCommandZone: false },
    { key: "dies:any", consumers: 2, suppliers: 2, available: 0.227, fromCommandZone: false },
    { key: "attacks:any", consumers: 3, suppliers: 0, available: null, fromCommandZone: false },
  ],
};

test("BuildBenchmarks shows answer coverage, including the classes the deck cannot answer", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.getByText(/answers by turn 5/i)).toBeInTheDocument();
  // A class with zero answers is the finding, so it must be a visible row rather than an omission.
  expect(screen.getByLabelText(/artifact, no answers/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/creature, 4 cards, 41% by turn 5/i)).toBeInTheDocument();
  // A commander answer is available every game, and says why rather than just reading 100%.
  expect(screen.getByLabelText(/graveyard, 1 card, always \(commander\)/i)).toBeInTheDocument();
});

test("BuildBenchmarks shows demand against supply, and refuses a number where none applies", () => {
  render(<BuildBenchmarks categories={SAMPLE.report.buildCategories} deckMath={DECK_MATH} />);
  expect(screen.getByLabelText(/dies:any, 2 cards want it, 2 supply it, 23% by turn 5/i)).toBeInTheDocument();
  // The game supplies a combat trigger: 0% would invent a hole, 100% would claim a board state
  // this layer does not model.
  expect(screen.getByLabelText(/attacks:any, 3 cards want it, the game supplies it/i)).toBeInTheDocument();
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
