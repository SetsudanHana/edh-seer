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
    positiveCoherence: 0.6,
    anchoring: 1.0,
    buildScore: 3.4,
  },
};

test("draws two groups, each with its lead dial and its inputs", () => {
  render(<DeckGauges data={DATA as never} onOpen={() => {}} />);
  for (const name of [
    "Synergy", "Breadth", "Anchor",
    "Build", "Consistency", "Ramp", "Interaction", "Board wipes", "Lands",
  ]) {
    expect(screen.getByText(name)).toBeInTheDocument();
  }
});

/** Each group is `role="group"` so a screen reader announces the lead score and its inputs as one
 *  unit; the label names both halves rather than repeating the lead dial's own printed name, which
 *  the component must not do a second time as a visible heading (task 9 brief). */
test("each group carries an aria-label naming the score and its inputs", () => {
  render(<DeckGauges data={DATA as never} onOpen={() => {}} />);
  expect(screen.getByRole("group", { name: "Synergy, and the two measures behind it" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Build, and the five measures behind it" })).toBeInTheDocument();
});

test("a report with only synergyOverall renders only the Synergy group", () => {
  const onlySynergy = {
    report: { synergyOverall: 4.2, positiveCoherence: 4.0, anchoring: 4.5 },
  };
  render(<DeckGauges data={onlySynergy as never} onOpen={() => {}} />);
  expect(screen.getByRole("group", { name: "Synergy, and the two measures behind it" })).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Build, and the five measures behind it" })).toBeNull();
  expect(screen.queryByText("Consistency")).toBeNull();
});

test("a report with only buildScore renders only the Build group", () => {
  const onlyBuild = { report: { ...DATA.report, synergyOverall: undefined, positiveCoherence: undefined, anchoring: undefined } };
  render(<DeckGauges data={onlyBuild as never} onOpen={() => {}} />);
  expect(screen.queryByRole("group", { name: "Synergy, and the two measures behind it" })).toBeNull();
  expect(screen.getByRole("group", { name: "Build, and the five measures behind it" })).toBeInTheDocument();
  expect(screen.queryByText("Breadth")).toBeNull();
  expect(screen.queryByText("Anchor")).toBeNull();
});

/** THE RATCHET FOR THE ONE CLAIM THIS WHOLE PANEL ARGUES FROM. `build.ts:520` is
 *  `Math.min(p.count / p.target, 1) // exceeding a floor never penalizes`, so a parent past its target
 *  scores FULL CREDIT and the trim chips call the same overshoot "where the room is". A dial reddening
 *  the over side would tell the reader the opposite of the score and the cut list on one screen.
 *
 *  IT ASSERTS THE TONE, NOT THE WORDING. The first version of this test checked only the label text,
 *  which `Dial` renders identically whatever the tone is -- so flipping `floorState`'s over side to
 *  danger would have passed it silently, which is precisely the regression it exists to catch.
 *
 *  The query is now scoped to the whole panel rather than one flat grid -- the group restructure
 *  (task 9) moved the same dials under the Build group, but the tone each one carries, and the
 *  claim that nothing anywhere ever reds out for being over, is unchanged. */
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

test("lands opens Mana, synergy opens Engine, build opens Build", () => {
  const onOpen = vi.fn();
  render(<DeckGauges data={DATA as never} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole("button", { name: /^Lands,/ }));
  expect(onOpen).toHaveBeenCalledWith("mana", undefined);
  fireEvent.click(screen.getByRole("button", { name: /^Synergy,/ }));
  expect(onOpen).toHaveBeenCalledWith("engine", undefined);
  fireEvent.click(screen.getByRole("button", { name: /^Build,/ }));
  expect(onOpen).toHaveBeenCalledWith("build", undefined);
});

/** Breadth and anchor are edge-derived exactly like synergy itself, so they take the same
 *  partly-read flag for the same reason `HeadlineScores` gives its own sub-line: a red verdict
 *  computed over half a deck is the engine's blindness rendered as the player's failure. The Build
 *  inputs count roles off printed text and type lines, which an unread card still has, so they keep
 *  their band -- this is the split the coverage gate already draws, proven here rather than assumed. */
test("synergy, breadth and anchor drop their verdict on a partly-read deck; the Build inputs keep theirs", () => {
  const partly = {
    report: { ...DATA.report, coverage: { resolved: 100, derived: 52, underivedNames: [], more: 0, caveat: "" } },
  };
  render(<DeckGauges data={partly as never} onOpen={() => {}} />);
  const unreadVerdicts = screen.getAllByText("too little of the deck read to call this");
  expect(unreadVerdicts).toHaveLength(3); // Synergy, Breadth and Anchor -- the same fixed message each
  // The numbers are not withheld -- refusing them would be a second wrong answer.
  expect(screen.getByText("0.8")).toBeInTheDocument(); // Synergy
  expect(screen.getByText("0.6")).toBeInTheDocument(); // Breadth
  expect(screen.getByText("1.0")).toBeInTheDocument(); // Anchor
  // Board wipes is a Build input, counted off printed text: it keeps its ordinary verdict.
  expect(screen.getByText("2 short")).toBeInTheDocument();
});

test("renders nothing rather than an empty shell when the engine computed no build", () => {
  const { container } = render(<DeckGauges data={{ report: {} } as never} onOpen={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

/** THE ORPHAN-CELL DEFECT (finding 2, whole-branch review, 2026-09-01) was a property of a fixed-
 *  column CSS GRID: a lone last dial landed in its own column beside an empty one, reading as a
 *  tile that failed to load. Task 9 replaced the single flat grid with one `flex flex-wrap` row of
 *  inputs per group -- a wrapping flex row has no column tracks, so there is no empty cell for a
 *  lone last item to sit beside AT ANY WIDTH: it simply centres on its own line, same as a short
 *  paragraph's last word. Proven structurally (no grid class present) rather than by re-deriving the
 *  old `:last-child:nth-child(Cn+1)` selector math for a grid that no longer exists. */
test("no width leaves a single input dial alone beside a blank cell: input rows wrap, they don't grid", () => {
  // Board wipes alone (one parent, no lands): the smallest possible non-empty Build input row.
  const oneInput = {
    report: {
      buildParents: [{ name: "Board wipes", count: 1, target: 3, leaves: ["boardWipe"] }],
      buildScore: 3.4,
    },
  };
  const { container } = render(<DeckGauges data={oneInput as never} onOpen={() => {}} />);
  const group = screen.getByRole("group", { name: "Build, and the five measures behind it" });
  const inputRow = group.lastElementChild as HTMLElement;
  expect(inputRow.children).toHaveLength(1); // the lone Board wipes dial
  expect(inputRow.className).toMatch(/\bflex-wrap\b/);
  expect(inputRow.className).not.toMatch(/\bgrid\b/);
  // And the container's own class name confirms it, panel-wide -- no `.deck-gauges-grid` survives.
  expect(container.querySelector(".deck-gauges-grid")).toBeNull();
});
