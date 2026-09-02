import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { Bullet, TARGET_MARK } from "./Bullet.js";
import { floorState, bandState, scoreState } from "../lib/deck-gauge.js";

const width = (el: Element) => (el as HTMLElement).style.width;

/** THE PROPERTY A ROW OF DIALS COULD NOT HAVE. Each dial carried its own private scale, so "Ramp 9"
 *  and "Interaction 4" pointed at unrelated angles; every bullet's tick sits at the same x, so two
 *  rows with different targets are read against each other by bar length alone. */
test("every target tick lands at the same place, whatever the target is", () => {
  render(
    <>
      <Bullet name="Ramp" value="9" reading={floorState(9, 10)} fill={(9 / 10) * TARGET_MARK} mark={TARGET_MARK} />
      <Bullet name="Wipes" value="3" reading={floorState(3, 2)} fill={(3 / 2) * TARGET_MARK} mark={TARGET_MARK} />
    </>,
  );
  const marks = screen.getAllByTestId("bullet-mark");
  expect(marks).toHaveLength(2);
  expect(new Set(marks.map((m) => (m as HTMLElement).style.left)).size).toBe(1);
});

/** THE BAR THAT CLAMPED AT ITS TARGET PAINTED FIVE DIFFERENT ROWS IDENTICALLY -- `13/10`, `4/4`,
 *  `14/10`, `1/1` and `37/36` all full width, and a land count 4 OVER drawing exactly like a ramp
 *  count 1 UNDER. Parking the target at 70% is what leaves room for overshoot to show. */
test("a count over its floor runs past the tick; one under stops short", () => {
  render(
    <>
      <Bullet name="Over" value="19" reading={floorState(19, 10)} fill={(19 / 10) * TARGET_MARK} mark={TARGET_MARK} />
      <Bullet name="Under" value="4" reading={floorState(4, 10)} fill={(4 / 10) * TARGET_MARK} mark={TARGET_MARK} />
    </>,
  );
  const [over, under] = screen.getAllByTestId("bullet-fill");
  expect(parseFloat(width(over!))).toBeGreaterThan(TARGET_MARK * 100);
  expect(parseFloat(width(under!))).toBeLessThan(TARGET_MARK * 100);
  // ...and clamped, so a wildly over count cannot paint past the track.
  expect(parseFloat(width(over!))).toBeLessThanOrEqual(100);
});

/** TWO DIFFERENT STATES MUST NOT PAINT IDENTICALLY -- the defect `TARGET_MARK` exists to prevent,
 *  which a plain clamp reintroduced the moment these bars went live: on a real deck
 *  `Interaction 15/10` and `Board wipes 4/2` both hit 100%. Compressed overshoot keeps the order
 *  readable for any excess and never reaches the end of the track. */
test("more over target always draws further right, and never fills the track", () => {
  const fills = [12, 15, 30, 100].map((n) => {
    const ratio = n / 10, over = ratio - 1;
    return TARGET_MARK + (1 - TARGET_MARK) * (over / (over + 1));
  });
  for (let i = 1; i < fills.length; i++) expect(fills[i]!).toBeGreaterThan(fills[i - 1]!);
  expect(fills.at(-1)!).toBeLessThan(1);
  expect(fills[0]!).toBeGreaterThan(TARGET_MARK);
});

/** OVER A FLOOR IS NOT A FAULT -- `build.ts:520` is `Math.min(count / target, 1)`, so a parent past
 *  its target scores full credit and the trim chips call the same overshoot "where the room is". */
test("over a floor reads neutral, never a fault", () => {
  render(<Bullet name="Ramp" value="19" reading={floorState(19, 10)} fill={1} mark={TARGET_MARK} />);
  expect(screen.getByText("9 over target")).toHaveAttribute("data-tone", "neutral");
});

/** A SCORE HAS NO TARGET, ONLY BANDS. Drawing a tick would invent a number; the bands are the
 *  meaning, and they come from the same `ZONES` table the dial's arc uses. */
test("a score draws its bands and no tick", () => {
  render(
    <Bullet name="Breadth" value="1.3" reading={scoreState(1.3)} fill={0.26} zones="score" />,
  );
  expect(screen.queryByTestId("bullet-mark")).toBeNull();
  expect(document.querySelectorAll("[data-zone]").length).toBeGreaterThan(0);
});

/** THE STATE IN WORDS, never the bar's colour alone (WCAG 1.4.1) -- and `data-tone` sits on the
 *  LABEL, which is `Dial`'s own contract so a test can pin tone independent of wording. */
test("the reading's words are printed, carrying the tone attribute", () => {
  render(<Bullet name="Lands" value="38" reading={bandState(38, 36)} fill={1} mark={TARGET_MARK} />);
  const label = screen.getByText(bandState(38, 36).label);
  expect(label).toHaveAttribute("data-tone");
});

// A MEASURE WITH NOWHERE TO GO IS NOT A BUTTON -- `Dial`'s rule, kept. Dropping this in the swap
// silently deleted the route from a role's count to its own leaves.
test("it is a button only when there is something to open", async () => {
  const onOpen = vi.fn();
  const { unmount } = render(
    <Bullet name="Interaction" value="4" reading={floorState(4, 10)} fill={0.28} mark={TARGET_MARK}
      onOpen={onOpen} openLabel="Build" />,
  );
  const btn = screen.getByRole("button", { name: /^Interaction, 4, .* open Build$/ });
  await userEvent.click(btn);
  expect(onOpen).toHaveBeenCalledOnce();
  unmount();

  render(<Bullet name="Ramp" value="9" reading={floorState(9, 10)} fill={0.63} mark={TARGET_MARK} />);
  expect(screen.queryByRole("button")).toBeNull();
});

// `BASE_TARGETS` gives burn and stax a target of 0, and `floorState` already answers that case with
// "no floor set" -- so there is no tick to draw and nothing to divide by.
test("a measure with no floor draws no tick", () => {
  render(<Bullet name="Burn" value="0" reading={floorState(0, 0)} fill={0} />);
  expect(screen.queryByTestId("bullet-mark")).toBeNull();
  expect(screen.getByText("no floor set")).toBeInTheDocument();
});
