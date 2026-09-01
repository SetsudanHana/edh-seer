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

/** Finding 2 (Major, whole-branch review, 2026-09-01). At 390px the grid is 2 columns, so a
 *  7-dial report leaves the last dial alone on its own row -- half width beside an empty cell,
 *  reading as a tile that failed to render. `index.css`'s `.deck-gauges-grid` rule spans the last
 *  child exactly when it would otherwise be the sole occupant of its row, expressed as
 *  `:last-child:nth-child(Cn+1)` for the column count `C` at each breakpoint -- true precisely
 *  when the total count leaves a remainder of 1 against C.
 *
 *  `DeckGauges` never renders a fixed number of dials -- one per `buildParents` row plus up to
 *  three conditional extras -- so this pins the SELECTOR'S behaviour against several counts,
 *  never a rule tuned to seven. jsdom implements `:nth-child`/`:last-child` structurally, so
 *  `Element.matches` proves the same predicate the CSS file applies, without needing jsdom to run
 *  the stylesheet's own `@media` cascade. */
test("the last dial is alone-in-row at 390px (2 cols) exactly when the count is odd", () => {
  // DATA: 4 buildParents + lands + synergy + build = 7 dials (odd).
  const { container: seven } = render(<DeckGauges data={DATA as never} onOpen={() => {}} />);
  const sevenGrid = seven.querySelector(".deck-gauges-grid")!;
  expect(sevenGrid.children).toHaveLength(7);
  expect(sevenGrid.lastElementChild!.matches(":last-child:nth-child(2n+1)")).toBe(true);

  // Dropping buildScore leaves 4 parents + lands + synergy = 6 dials (even): the last row of a
  // 2-column grid is full (3 rows of 2), so nothing should be spanned.
  const sixReport = { report: { ...DATA.report, buildScore: undefined } };
  const { container: six } = render(<DeckGauges data={sixReport as never} onOpen={() => {}} />);
  const sixGrid = six.querySelector(".deck-gauges-grid")!;
  expect(sixGrid.children).toHaveLength(6);
  expect(sixGrid.lastElementChild!.matches(":last-child:nth-child(2n+1)")).toBe(false);
});

/** Proves the rule generalises past two columns and past seven dials, which is what the fix is
 *  FOR -- `sm:grid-cols-3` (768px) and `lg:grid-cols-4` (1024px) both wrap a 5-dial report (4
 *  parents + lands, no synergy or build score) with a single dial alone on the last row, and
 *  `xl:grid-cols-7` never does, because five fits one row of seven outright. */
test("the alone-in-row rule holds for a count other than seven, at the other two breakpoints", () => {
  const fiveReport = {
    report: { ...DATA.report, synergyOverall: undefined, buildScore: undefined },
  };
  const { container } = render(<DeckGauges data={fiveReport as never} onOpen={() => {}} />);
  const grid = container.querySelector(".deck-gauges-grid")!;
  expect(grid.children).toHaveLength(5);
  const last = grid.lastElementChild!;
  expect(last.matches(":last-child:nth-child(2n+1)")).toBe(true); // 390px, 2 cols: 5 % 2 === 1
  expect(last.matches(":last-child:nth-child(3n+1)")).toBe(false); // 768px, 3 cols: 5 % 3 === 2
  expect(last.matches(":last-child:nth-child(4n+1)")).toBe(true); // 1024px, 4 cols: 5 % 4 === 1
});
