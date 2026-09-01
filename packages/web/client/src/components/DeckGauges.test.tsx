import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DeckGauges } from "./DeckGauges.js";

const DATA = {
  report: {
    buildParents: [
      { name: "Consistency", count: 15, target: 14, leaves: ["draw", "cardSelection"] },
      { name: "Ramp", count: 17, target: 10, leaves: ["ramp"] },
      { name: "Interaction", count: 19, target: 10, leaves: ["targetedRemoval", "protection"] },
      { name: "Board wipes", count: 1, target: 3, leaves: ["boardWipe"] },
    ],
    deckMath: { lands: { actual: 38, target: 36, avgManaValue: 2.92 } },
    synergyOverall: 0.8,
    buildScore: 3.4,
  },
};

test("draws one dial per role, plus lands and the two scores", () => {
  render(<DeckGauges data={DATA as never} onOpen={() => {}} />);
  for (const name of ["Consistency", "Ramp", "Interaction", "Board wipes", "Lands", "Synergy", "Build"]) {
    expect(screen.getByText(name)).toBeInTheDocument();
  }
});

/** THE DIAL AND THE SCORE MUST NOT DISAGREE. `build.ts:517` gives a parent past its target full
 *  credit, so no input may make the dial say a deck is failing where the score says it is perfect.
 *  This is the contradiction the whole asymmetry exists to prevent; pinned so it cannot come back. */
test("no over-target role ever renders as a fault", () => {
  render(<DeckGauges data={DATA as never} onOpen={() => {}} />);
  expect(screen.getByText("9 over target")).toBeInTheDocument();
  expect(screen.getByText("7 over target")).toBeInTheDocument();
  expect(screen.queryByText(/far over/)).toBeNull();
});

test("a multi-leaf role opens its group on Build", () => {
  const onOpen = vi.fn();
  render(<DeckGauges data={DATA as never} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole("button", { name: /^Interaction,/ }));
  expect(onOpen).toHaveBeenCalledWith("build", "Interaction");
});

/** Ramp and Board wipes are single-leaf parents: `BuildBenchmarks` renders no group for them, so
 *  there is nothing on Build to open. They are dials, not buttons. */
test("a single-leaf role is not a button", () => {
  render(<DeckGauges data={DATA as never} onOpen={() => {}} />);
  expect(screen.queryByRole("button", { name: /^Ramp,/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Board wipes,/ })).toBeNull();
});

test("lands opens Mana and synergy opens Engine", () => {
  const onOpen = vi.fn();
  render(<DeckGauges data={DATA as never} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole("button", { name: /^Lands,/ }));
  expect(onOpen).toHaveBeenCalledWith("mana", undefined);
  fireEvent.click(screen.getByRole("button", { name: /^Synergy,/ }));
  expect(onOpen).toHaveBeenCalledWith("engine", undefined);
});

test("synergy drops its verdict when the deck was only partly read", () => {
  const partly = {
    report: { ...DATA.report, coverage: { resolved: 100, derived: 52, underivedNames: [], more: 0, caveat: "" } },
  };
  render(<DeckGauges data={partly as never} onOpen={() => {}} />);
  expect(screen.getByText("too little of the deck read to call this")).toBeInTheDocument();
  // The number is not withheld -- refusing it would be a second wrong answer.
  expect(screen.getByText("0.8")).toBeInTheDocument();
});

test("renders nothing rather than an empty shell when the engine computed no build", () => {
  const { container } = render(<DeckGauges data={{ report: {} } as never} onOpen={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});
