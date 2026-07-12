import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { SynergyList } from "./SynergyList.js";
import { ComboList } from "./ComboList.js";
import { ThemeBars } from "./ThemeBars.js";
import { MissingCards } from "./MissingCards.js";
import { SAMPLE } from "../fixtures.js";

test("SynergyList shows the pair and its reason", () => {
  render(<SynergyList edges={SAMPLE.report.edges} />);
  expect(screen.getByText(/Krenko, Mob Boss/)).toBeInTheDocument();
  expect(screen.getByText(/Impact Tremors/)).toBeInTheDocument();
  expect(screen.getByText(/pays off tokens/)).toBeInTheDocument();
});

test("ComboList shows the combo result", () => {
  render(<ComboList combos={SAMPLE.report.combos} />);
  expect(screen.getByText(/Infinite loop/)).toBeInTheDocument();
  expect(screen.getByText(/Phyrexian Altar/)).toBeInTheDocument();
});

test("ThemeBars shows theme tallies and roles", () => {
  render(<ThemeBars themes={SAMPLE.report.themes} roles={SAMPLE.report.roles} />);
  expect(screen.getByText(/token/)).toBeInTheDocument();
  expect(screen.getByText(/draw/)).toBeInTheDocument();
  expect(screen.getByText(/10/)).toBeInTheDocument();
});

test("MissingCards lists unresolved names", () => {
  render(<MissingCards missing={SAMPLE.missing} />);
  expect(screen.getByText(/Beholder's Death Ray/)).toBeInTheDocument();
});

test("MissingCards renders nothing when empty", () => {
  const { container } = render(<MissingCards missing={[]} />);
  expect(container).toBeEmptyDOMElement();
});
