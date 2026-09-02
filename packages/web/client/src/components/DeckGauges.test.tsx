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
    // `getAllBy`, because S15 moved each score's gloss onto its own dial and those sentences name
    // Breadth and Anchor in prose ("Breadth is how much of the deck sits on its main theme"). The
    // assertion is that the label is drawn, not that the word occurs once on a panel that now
    // explains itself.
    expect(screen.getAllByText(name).length, name).toBeGreaterThan(0);
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
  // The Synergy group is absent, so its gloss is too -- nothing names Breadth or Anchor anywhere.
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

/** TASK 9 FIX ROUND 1 (whole-branch review, 2026-09-01): `flex flex-wrap` measured out as TWO
 *  defects, not zero -- a flex item sizes to its own content and does not shrink across a wrap
 *  point, which stranded Lands alone at 1440px (4+1) and, at 390px, wrapped NOTHING at all (55%
 *  longer Summary page). Reverted to CSS grid, split per group because the two groups have
 *  different counts:
 *
 *  jsdom does not run layout, so this cannot measure pixels -- it can only prove the CLASS NAMES
 *  that drive the grid are the ones the math below assumes, and that the orphan-span selector
 *  matches the DOM shapes it is meant to catch. The arithmetic itself (confirmed against the
 *  actual compiled Tailwind CSS, not assumed) is:
 *
 *  `App.tsx`'s `<main class="p-8 max-w-5xl xl:max-w-none">` leaves content width
 *  390->326px, 768->704px, 1024->960px, 1440->1376px (p-8 = 32px/side; max-w-5xl = 1024px, dropped
 *  at xl/1280px). `gap-3` = 12px. The INPUT dial's arc is `max-w-28` (112px) below `sm`/640px and
 *  `max-w-[9rem]` (144px) from `sm` up; its shell is `p-4` (32px) plus a 1px border each side, so
 *  each dial needs at most 112+32+2=146px narrow or 144+32+2=178px from `sm` up.
 *
 *  | width | Synergy (always 2 col) | Build (2 / sm:3 / xl:5 col) |
 *  |---|---|---|
 *  | 390  | track (326-12)/2=157, needs 146 -- 2/row            | same track/need -- 2,2,1(spanned) |
 *  | 768  | track (704-12)/2=346, needs 178 -- 2/row            | 3 col: track (704-24)/3=227, needs 178 -- 3,2 |
 *  | 1024 | track (960-12)/2=474, needs 178 -- 2/row            | 3 col: track (960-24)/3=312, needs 178 -- 3,2 |
 *  | 1440 | track (1376-12)/2=682, needs 178 -- 2/row           | 5 col: track (1376-48)/5=266, needs 178 -- 5/row |
 *
 *  Every track clears its need with room to spare -- confirmed via `vite build` and grepping the
 *  compiled CSS for `.max-w-28`, `.p-4`, `.gap-3`, `.grid-cols-2/3/5` and the `40rem`/`80rem` media
 *  queries, not assumed from the Tailwind scale by memory. `grid-cols-N` also compiles to
 *  `repeat(N, minmax(0, 1fr))` -- the `0` minimum is what lets a track shrink below its content's
 *  natural size at all, which a `flex-wrap` row never had. */
test("the input grids carry the classes the measured layout table above depends on", () => {
  const { container } = render(<DeckGauges data={DATA as never} onOpen={() => {}} />);
  const synergyGrid = container.querySelector(".synergy-inputs-grid")!;
  const buildGrid = container.querySelector(".build-inputs-grid")!;
  expect(synergyGrid.className).toMatch(/\bgrid\b/);
  expect(synergyGrid.className).toMatch(/\bgrid-cols-2\b/);
  expect(buildGrid.className).toMatch(/\bgrid-cols-2\b/);
  expect(buildGrid.className).toMatch(/\bsm:grid-cols-3\b/);
  expect(buildGrid.className).toMatch(/\bxl:grid-cols-5\b/);
  // No stray flex-wrap row survives from the reverted attempt.
  expect(container.querySelector(".flex-wrap")).toBeNull();
});

/** The orphan-span selector itself, proven the same way the pre-task-9 flat-grid version was:
 *  jsdom implements `:nth-child`/`:last-child` structurally, so `Element.matches` proves the exact
 *  predicate the CSS applies without needing jsdom to run the stylesheet's own `@media` cascade.
 *  Five Build inputs (4 parents + lands) leave the last one at position 5 -- odd, so the 2-column
 *  tier's rule spans it; four (drop lands) leave it at position 4 -- even, no span needed, because
 *  4 items in 2 columns is a clean 2+2. */
test("build-inputs-grid's last-dial-alone selector matches only when the count is odd", () => {
  const { container: five } = render(<DeckGauges data={DATA as never} onOpen={() => {}} />);
  const fiveGrid = five.querySelector(".build-inputs-grid")!;
  expect(fiveGrid.children).toHaveLength(5);
  expect(fiveGrid.lastElementChild!.matches(":last-child:nth-child(2n+1)")).toBe(true);

  const fourReport = { report: { ...DATA.report, deckMath: undefined } };
  const { container: four } = render(<DeckGauges data={fourReport as never} onOpen={() => {}} />);
  const fourGrid = four.querySelector(".build-inputs-grid")!;
  expect(fourGrid.children).toHaveLength(4);
  expect(fourGrid.lastElementChild!.matches(":last-child:nth-child(2n+1)")).toBe(false);
});

/** Synergy's grid is always 2 columns, so 2 items (the ordinary case) never orphan -- but the
 *  span rule is kept for the near-impossible case of only one of Breadth/Anchor existing, so a
 *  lone dial doesn't sit alone in the LEFT cell beside a blank right one. */
test("synergy-inputs-grid's span rule protects the near-impossible one-measure case too", () => {
  const { container: two } = render(<DeckGauges data={DATA as never} onOpen={() => {}} />);
  const twoGrid = two.querySelector(".synergy-inputs-grid")!;
  expect(twoGrid.children).toHaveLength(2);
  expect(twoGrid.lastElementChild!.matches(":last-child:nth-child(2n+1)")).toBe(false);

  const onlyBreadth = { report: { ...DATA.report, anchoring: undefined } };
  const { container: one } = render(<DeckGauges data={onlyBreadth as never} onOpen={() => {}} />);
  const oneGrid = one.querySelector(".synergy-inputs-grid")!;
  expect(oneGrid.children).toHaveLength(1);
  expect(oneGrid.lastElementChild!.matches(":last-child:nth-child(2n+1)")).toBe(true);
});
