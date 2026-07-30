import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { CardSynergyList } from "./CardSynergyList.js";
import { ComboList } from "./ComboList.js";
import { ThemeBars } from "./ThemeBars.js";
import { MissingCards } from "./MissingCards.js";
import { CardBucketBoard } from "./CardBucketBoard.js";
import { SAMPLE } from "../fixtures.js";

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
  expect(screen.getAllByText(/Card synergies/).length).toBeGreaterThan(0);
  // Impact Tremors qualifies for 3 buckets (consistency, synergy, win-condition).
  expect(screen.getByText("3/4")).toBeInTheDocument();
  // Krenko qualifies for 2 buckets (synergy, win-condition).
  expect(screen.getByText("2/4")).toBeInTheDocument();
});
