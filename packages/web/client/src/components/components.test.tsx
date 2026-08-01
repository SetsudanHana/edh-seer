import { render, screen, within } from "@testing-library/react";
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
import { SAMPLE } from "../fixtures.js";

test("DeckIdentity shows the primary and secondary theme", () => {
  render(<DeckIdentity cohesion={SAMPLE.report.cohesion} />);
  expect(screen.getByText("Tokens")).toBeInTheDocument();
  expect(screen.getByText("Goblins")).toBeInTheDocument();
  expect(screen.getByText(/highly focused/)).toBeInTheDocument();
  expect(screen.getByText("65%")).toBeInTheDocument();
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

test("MissingCards lists unresolved names", () => {
  render(<MissingCards missing={SAMPLE.missing} />);
  expect(screen.getByText(/Beholder's Death Ray/)).toBeInTheDocument();
});

test("MissingCards renders nothing when empty", () => {
  const { container } = render(<MissingCards missing={[]} />);
  expect(container).toBeEmptyDOMElement();
});

test("StatTiles shows ramp, draw, removal, avg CMC, and land count", () => {
  render(<StatTiles roles={{ ramp: 4, draw: 10, removal: 6 }} avgManaValue={2.7} landCount={38} />);
  expect(screen.getByText("4")).toBeInTheDocument();
  expect(screen.getByText("10")).toBeInTheDocument();
  expect(screen.getByText("6")).toBeInTheDocument();
  expect(screen.getByText("2.7")).toBeInTheDocument();
  expect(screen.getByText("38")).toBeInTheDocument();
  expect(screen.getByText("Ramp")).toBeInTheDocument();
  expect(screen.getByText("Lands")).toBeInTheDocument();
});

test("OverviewTab renders deck identity and stat tiles from the full response", () => {
  render(<OverviewTab data={SAMPLE} />);
  expect(screen.getByText("Tokens")).toBeInTheDocument(); // DeckIdentity theme
  expect(screen.getByText("38")).toBeInTheDocument(); // landCount stat tile
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
  expect(screen.getByText("8")).toBeInTheDocument(); // peak bar's direct cap label
  expect(screen.getByTitle("8 cards at mana value 2")).toBeInTheDocument();
});

test("LandMathChart shows 8 bars (0-7 lands), labels the peak percentage, and calculates hypergeometric odds correctly", () => {
  render(<LandMathChart landCount={38} deckSize={99} />);
  // x-axis ticks 0..7 are each rendered exactly once
  for (let k = 0; k <= 7; k++) {
    expect(screen.getByText(String(k))).toBeInTheDocument();
  }
  // Peak at k=3 with ~29.57% → rounds to 30%
  expect(screen.getByText("30%")).toBeInTheDocument(); // peak bar's direct cap label
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

test("CardList sorts by the max of any bucket/synergy score, descending", () => {
  render(<CardList cards={SAMPLE.report.cards} />);
  // Row 0 is the header; data rows start at index 1.
  const rows = screen.getAllByRole("row").slice(1).map((el) => el.textContent ?? "");
  // Krenko: max(bucketScores.win-condition=1.38, score=6) = 6.
  // Impact Tremors: max(bucketScores.consistency=1.0, .win-condition=0.23, score=2) = 2.
  expect(rows[0]).toContain("Krenko, Mob Boss");
  expect(rows[1]).toContain("Impact Tremors");
});

test("CardList shows one role-badge dot per bucket the card qualifies for", () => {
  render(<CardList cards={SAMPLE.report.cards} />);
  // Scope to Krenko's own row — both cards render at once, and Impact Tremors DOES
  // have a Consistency dot, so an unscoped query would false-positive on it.
  const rows = screen.getAllByRole("row");
  const krenkoRow = rows.find((r) => r.textContent?.includes("Krenko, Mob Boss"))!;
  expect(within(krenkoRow).getByTitle(/Win Condition: 1.38/)).toBeInTheDocument();
  expect(within(krenkoRow).getByTitle(/Synergy: 6.00/)).toBeInTheDocument();
  expect(within(krenkoRow).queryByTitle(/Consistency/)).not.toBeInTheDocument(); // Krenko's consistency is 0
});

test("CardList filter narrows to cards qualifying for the selected bucket", async () => {
  render(<CardList cards={SAMPLE.report.cards} />);
  await userEvent.click(screen.getByText("Consistency"));
  // Only Impact Tremors has consistency > 0; Krenko's consistency is 0.
  expect(screen.getByText("Impact Tremors")).toBeInTheDocument();
  expect(screen.queryByText("Krenko, Mob Boss")).not.toBeInTheDocument();
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

test("HeadlineScores shows SYNERGY and BUILD with band labels and sub-facets", () => {
  render(<HeadlineScores report={SAMPLE.report} />);
  expect(screen.getByText(/SYNERGY/i)).toBeInTheDocument();
  expect(screen.getByText("4.0")).toBeInTheDocument();      // synergyOverall
  expect(screen.getByText(/BUILD/i)).toBeInTheDocument();
  expect(screen.getByText("3.7")).toBeInTheDocument();      // buildScore
  expect(screen.getAllByText(/Tuned|Focused/).length).toBeGreaterThan(0); // band labels (both tiles have one)
  expect(screen.getByText(/breadth/i)).toBeInTheDocument(); // sub-facet
});
