import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { Dial, SCORE_ZONES, ZONES } from "./Dial.js";
import { floorState, bandState, scoreState, TONE_OF_SCORE } from "../lib/deck-gauge.js";
import { scoreBand } from "../lib/score-band.js";

test("prints the name, the value and the state in words", () => {
  render(<Dial name="Interaction" value="19" reading={floorState(19, 10)} zones="floor" />);
  expect(screen.getByText("Interaction")).toBeInTheDocument();
  expect(screen.getByText("19")).toBeInTheDocument();
  // The state is TEXT, never tone alone -- WCAG 1.4.1.
  expect(screen.getByText("9 over target")).toBeInTheDocument();
});

test("is a button that opens its detail, and says so to a screen reader", async () => {
  const onOpen = vi.fn();
  render(<Dial name="Interaction" value="19" reading={floorState(19, 10)} zones="floor" onOpen={onOpen} openLabel="Build" />);
  const b = screen.getByRole("button", { name: "Interaction, 19, 9 over target — open Build" });
  fireEvent.click(b);
  expect(onOpen).toHaveBeenCalledOnce();
});

/** A dial with nowhere to go is not a button. Ramp and Board wipes are single-leaf parents and
 *  render no group on the Build tab, so they have no detail to open -- offering the affordance
 *  would be a control that does nothing. */
test("renders as plain content when there is nothing to open", () => {
  render(<Dial name="Ramp" value="17" reading={floorState(17, 10)} zones="floor" />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("Ramp")).toBeInTheDocument();
});

/** `size="lead"` draws a bigger arc and a bigger figure (task 9: the two score dials lead their own
 *  group); everything else about the dial -- zones, needle, `data-tone`, the button/div split -- is
 *  untouched by the prop, which the other tests in this file keep proving without ever passing it. */
test("size=lead draws a bigger arc and a bigger figure than the default input size", () => {
  const { container: input } = render(<Dial name="Breadth" value="0.6" reading={scoreState(0.6)} zones="score" />);
  const { container: lead } = render(<Dial name="Synergy" value="0.8" reading={scoreState(0.8)} zones="score" size="lead" />);
  expect(input.querySelector("svg")!.className.baseVal).toContain("max-w-[9rem]");
  expect(lead.querySelector("svg")!.className.baseVal).toContain("max-w-56");
  expect(screen.getAllByText("0.6")[0].className).toContain("text-2xl");
  expect(screen.getAllByText("0.8")[0].className).toContain("text-4xl");
});

test("the arc itself is hidden from screen readers", () => {
  const { container } = render(<Dial name="Build" value="3.4" reading={scoreState(3.4)} zones="score" />);
  const svg = container.querySelector("svg");
  expect(svg).toHaveAttribute("aria-hidden", "true");
});

test("draws one zone per band of its kind", () => {
  const { container: floor } = render(<Dial name="A" value="1" reading={floorState(10, 10)} zones="floor" />);
  const { container: score } = render(<Dial name="B" value="1" reading={scoreState(3)} zones="score" />);
  // floor: far-under, under, on-target, room = 4.
  expect(floor.querySelectorAll("[data-zone]")).toHaveLength(4);
  /** THREE ZONES FOR A FOUR-BAND SCORE, and that is the correct count. `scoreBand`'s Focused and
   *  Tuned both carry the success tone, so drawing them as two arcs put an invisible boundary on
   *  the dial -- one band pretending to be two. The zones are derived from `SCORE_BREAKS` and
   *  adjacent equal tones are merged, so this number follows the bands instead of being asserted
   *  independently of them. Which of the four bands a reading is in is still said in words beside
   *  the arc. */
  expect(score.querySelectorAll("[data-zone]")).toHaveLength(3);
});

/** NOTHING ELSE ENFORCES THAT `Dial`'s hand-written `FLOOR_ZONES`/`BAND_ZONES` boundaries agree
 *  with the `position` values `floorState`/`bandState` actually emit (IMPORTANT C, whole-branch
 *  review, 2026-09-01). They agree today, but a changed threshold in `deck-gauge.ts` would put the
 *  needle in a zone of a DIFFERENT tone with nothing failing -- the two files would keep drawing
 *  and computing without ever being compared. Driven from the readings themselves, one
 *  representative count per state, rather than from a second copy of the boundary literals: what
 *  is checked is that the zone CONTAINING the emitted position carries the same tone the reading
 *  itself carries. */
test("every floor and band reading's position lands in a zone of its own tone", () => {
  const zoneFor = (zones: typeof ZONES.floor, position: number) =>
    zones.find((z) => position >= z.from && position <= z.to);

  const floorReadings = [
    floorState(0, 10),  // far-under
    floorState(9, 10),  // under
    floorState(10, 10), // on-target
    floorState(20, 10), // room
  ];
  for (const r of floorReadings) {
    const zone = zoneFor(ZONES.floor, r.position);
    expect(zone, `no floor zone contains position ${r.position} (${r.state})`).toBeDefined();
    expect(zone!.tone).toBe(r.tone);
  }

  const bandReadings = [
    bandState(20, 36), // far-under
    bandState(30, 36), // under
    bandState(36, 36), // on-band
    bandState(42, 36), // over
    bandState(52, 36), // far-over
  ];
  for (const r of bandReadings) {
    const zone = zoneFor(ZONES.band, r.position);
    expect(zone, `no band zone contains position ${r.position} (${r.state})`).toBeDefined();
    expect(zone!.tone).toBe(r.tone);
  }
});

/** THIS TEST USED TO RECOMPUTE THE EXPECTED BOUNDARY FROM `SCORE_BREAKS` ON BOTH SIDES (MINOR F,
 *  whole-branch review, 2026-09-01) -- `(SCORE_BREAKS[1] / 5) * 2 - 1` on the assertion side,
 *  `scorePosition` doing the identical arithmetic inside `buildScoreZones` on the production side.
 *  A hand-written zone table that happened to match today's breaks by coincidence would still pass:
 *  the test could never fail on the defect named in its own title, because it never asked whether
 *  the DRAWN zone agrees with what `scoreBand` says about a score, only whether two copies of the
 *  same formula produce the same number. Replaced with a pointwise agreement check: for scores
 *  sampled across the whole 0-5 range, the zone the score's position falls in must carry the tone
 *  `scoreBand` gives that same score -- checking the thing the title claims, not a formula that
 *  could be wrong in the same way twice. */
test("the score zones are derived from SCORE_BREAKS, not hand-written", () => {
  for (let score = 0; score <= 5; score += 0.1) {
    const position = (score / 5) * 2 - 1;
    const zone = SCORE_ZONES.find((z) => position >= z.from && position <= z.to);
    expect(zone, `no score zone contains position ${position} (score ${score})`).toBeDefined();
    expect(zone!.tone).toBe(TONE_OF_SCORE[scoreBand(score).tone]);
  }
});
