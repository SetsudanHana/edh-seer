import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { DeckIdentity } from "./DeckIdentity.js";
import { CardSynergyList } from "./CardSynergyList.js";
import { ComboList } from "./ComboList.js";
import { ThemeBars } from "./ThemeBars.js";
import { MissingCards } from "./MissingCards.js";
import { CardBucketBoard } from "./CardBucketBoard.js";
import { StatTiles } from "./StatTiles.js";
import { OverviewTab } from "./OverviewTab.js";
import { ManaCurveChart } from "./ManaCurveChart.js";
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

test("CardSynergyList ranks cards, badges the commander, and shows partner reasons", () => {
  render(<CardSynergyList cards={SAMPLE.report.cards} commanders={SAMPLE.report.commanders} />);
  expect(screen.getAllByText(/Krenko, Mob Boss/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/commander/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/synergizes with 2/i)).toBeInTheDocument();
  expect(screen.getAllByText(/pays off tokens/).length).toBeGreaterThan(0);
});

test("ComboList shows the combo result", () => {
  render(<ComboList combos={SAMPLE.report.combos} />);
  expect(screen.getByText(/Infinite loop/)).toBeInTheDocument();
  expect(screen.getByText(/Phyrexian Altar/)).toBeInTheDocument();
});

test("ThemeBars shows theme tallies", () => {
  render(<ThemeBars themes={SAMPLE.report.themes} />);
  expect(screen.getByText(/token/)).toBeInTheDocument();
  expect(screen.getByText("4")).toBeInTheDocument();
});

test("MissingCards lists unresolved names", () => {
  render(<MissingCards missing={SAMPLE.missing} />);
  expect(screen.getByText(/Beholder's Death Ray/)).toBeInTheDocument();
});

test("MissingCards renders nothing when empty", () => {
  const { container } = render(<MissingCards missing={[]} />);
  expect(container).toBeEmptyDOMElement();
});

test("CardBucketBoard renders 4 sections and shows an N/4 badge for multi-bucket cards", () => {
  render(<CardBucketBoard cards={SAMPLE.report.cards} commanders={SAMPLE.report.commanders} />);
  expect(screen.getByText(/Consistency/)).toBeInTheDocument();
  expect(screen.getByText(/Efficiency/)).toBeInTheDocument();
  expect(screen.getByText(/Win Condition/)).toBeInTheDocument();
  expect(screen.getAllByText(/Synergy/).length).toBeGreaterThan(0);
  // Impact Tremors qualifies for 3 buckets (consistency, synergy, win-condition).
  expect(screen.getByText("3/4 roles")).toBeInTheDocument();
  // Krenko qualifies for 2 buckets (synergy, win-condition).
  expect(screen.getByText("2/4 roles")).toBeInTheDocument();
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
