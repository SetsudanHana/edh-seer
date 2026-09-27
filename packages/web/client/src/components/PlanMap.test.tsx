import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { buildEngineModel } from "../lib/engine-model.js";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { PlanMap } from "./PlanMap.js";
import { WinPlans } from "./WinPlans.js";

const model = () => { const { report, graph } = engineDeck(); return buildEngineModel(report, graph); };

/** THE PLAN AS A MAP (report cohesion audit, 2026-09-27): finishers in the middle, the plan's
 *  other cards around them, a line for each link, and a dashed ring on a card nothing joins. */
test("draws the finishers in the middle, the plan's cards around, and dashes a card with no link", () => {
  render(<PlanMap model={model()} middle={["Payoff A"]} around={["Cleric 1", "Cleric 2", "Vanilla"]} />);
  expect(screen.getAllByTestId("plan-map-middle").map((n) => n.getAttribute("aria-label"))).toEqual(["Open Payoff A"]);
  const ring = screen.getAllByTestId("plan-map-card");
  expect(ring.map((n) => n.getAttribute("aria-label"))).toEqual(["Open Cleric 1", "Open Cleric 2", "Open Vanilla"]);
  expect(ring.filter((n) => n.hasAttribute("data-alone")).map((n) => n.getAttribute("aria-label"))).toEqual(["Open Vanilla"]);
  expect(screen.getByTestId("plan-map").querySelectorAll("line")).toHaveLength(2);
  expect(screen.getByText(/works with none of these/)).toBeInTheDocument();
});

test("hovering a card fades what it does not touch", () => {
  render(<PlanMap model={model()} middle={["Payoff A"]} around={["Cleric 1", "Vanilla"]} />);
  const [cleric, vanilla] = screen.getAllByTestId("plan-map-card");
  fireEvent.mouseEnter(cleric!);
  expect(vanilla).toHaveAttribute("opacity", "0.3");
  expect(cleric).toHaveAttribute("opacity", "1");
});

test("with the deck's links, the picked plan is a map; a plan with no finishers centres the commander", () => {
  const wincons = { focus: 0.6, primary: "go-wide", classes: [
    { class: "go-wide", count: 3, share: 0.6, cards: ["Cleric 1", "Cleric 2"], payoffs: ["Payoff A"] },
    { class: "burn", count: 2, share: 0.4, cards: ["Payoff B", "Reducer"] },
  ] } as never;
  render(<WinPlans wincons={wincons} model={model()} />);
  expect(screen.queryByTestId("win-plan-cards")).toBeNull();
  expect(screen.getByText("finishes it")).toBeInTheDocument();
  fireEvent.click(screen.getAllByTestId("win-plan")[1]!);
  expect(screen.getByTestId("plan-map-middle")).toHaveAttribute("aria-label", "Open Commander");
  expect(screen.getByText("your commander")).toBeInTheDocument();
});
