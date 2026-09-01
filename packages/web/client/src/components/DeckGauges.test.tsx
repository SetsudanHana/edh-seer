import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DeckGauges } from "./DeckGauges.js";
import { floorState } from "../lib/deck-gauge.js";

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

/** THE RATCHET FOR THE ONE CLAIM THIS WHOLE PANEL ARGUES FROM. `build.ts:520` is
 *  `Math.min(p.count / p.target, 1) // exceeding a floor never penalizes`, so a parent past its target
 *  scores FULL CREDIT and the trim chips call the same overshoot "where the room is". A dial reddening
 *  the over side would tell the reader the opposite of the score and the cut list on one screen.
 *
 *  IT ASSERTS THE TONE, NOT THE WORDING. The first version of this test checked only the label text,
 *  which `Dial` renders identically whatever the tone is -- so flipping `floorState`'s over side to
 *  danger would have passed it silently, which is precisely the regression it exists to catch. */
test("no over-target role ever renders as a fault", () => {
  const { container } = render(<DeckGauges data={DATA as never} onOpen={() => {}} />);
  const tones = [...container.querySelectorAll("[data-tone]")].map((el) => ({
    label: el.textContent,
    tone: el.getAttribute("data-tone"),
  }));
  // Interaction 19/10 and Ramp 17/10 are both far past their floors.
  expect(tones).toContainEqual({ label: "9 over target", tone: "neutral" });
  expect(tones).toContainEqual({ label: "7 over target", tone: "neutral" });
  // And nothing anywhere in the panel reds out for being over.
  expect(tones.filter((t) => /over target/.test(t.label ?? ""))
    .every((t) => t.tone === "neutral")).toBe(true);
});

/** Proves the guard above is not vacuous: the tone it pins comes from `floorState`, so if that ever
 *  reds the over side this assertion fails first and names the reason. */
test("floorState is what makes the over side neutral", () => {
  expect(floorState(19, 10).tone).toBe("neutral");
  expect(floorState(7, 10).tone).toBe("danger");
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
