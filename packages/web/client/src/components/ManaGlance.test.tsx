import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { bandState } from "../lib/deck-gauge.js";
import { ManaGlance } from "./ManaGlance.js";

const deckMath = {
  lands: { actual: 34, target: 37 },
  colors: [
    { color: "U", supplied: 20 },
    { color: "B", supplied: 13, worst: { pips: 2, turn: 2, required: 17, requiredRaw: 17, cards: 1, available: 13 } },
  ],
  castability: { cards: [
    { name: "Rakdos Charm", turn: 2, castable: { low: 0.42, high: 0.51 }, mana: { low: 0.7, high: 0.8 } },
    { name: "Dire Fleet Ravager", turn: 5, castable: { low: 0.48, high: 0.48 }, mana: { low: 0.55, high: 0.55 } },
  ] },
} as never;
const manaAvailability = { headline: { mana: 6, turn: 6, low: 0.52, high: 0.52 } } as never;

/** FIVE ANSWERS BEFORE THE NUMBERS (owner, 2026-09-27: "manabase is also a section that no one is
 *  going to read through"). */
test("the manabase opens with one tile per question, flagging what is short", () => {
  render(<ManaGlance deckMath={deckMath} manaAvailability={manaAvailability} landCount={34} deckSize={100} />);
  const [lands, colour, hands, mana, cast] = screen.getAllByTestId("mana-tile");
  expect(lands).toHaveTextContent("Lands34wants 37: 3 under, within the normal ±3");
  expect(colour).toHaveTextContent("Weakest colour");
  // Which number is which (persona round 2026-09-29): usable by then, in the deck, and needed.
  // NO SLASH (#1033): "30 /37 (of 38 in the deck)" read as a fraction of 37 four rounds running.
  expect(colour).toHaveTextContent(/13 of 17 neededShort of black: you run 13 black sources\. A card wanting.*needs 17 by turn 2\.$/);
  expect(colour).not.toHaveTextContent("/17");
  expect(hands).toHaveTextContent(/Opening hands\d+%have 2 to 4 lands/);
  expect(mana).toHaveTextContent("Mana52%to make 6 mana by turn 6");
  expect(cast).toHaveTextContent("Hardest cast48%Dire Fleet Ravager on turn 5");
});

test("a deck short of nothing says so", () => {
  const fine = { lands: { actual: 37, target: 37 }, colors: [{ color: "G", supplied: 30 }], castability: { cards: [] } } as never;
  render(<ManaGlance deckMath={fine} landCount={37} deckSize={100} />);
  expect(screen.getByText("wants 37: right on target")).toBeInTheDocument();
  expect(screen.getByText("enough sources for every card")).toBeInTheDocument();
});

/** ONE READING OF THE LAND COUNT (#759). The tile had its own ±2, so a deck the Lands dial and the
 *  score call fine was flagged here; now it says what the dial says, and flags only past the band. */
test("the lands tile reads the count as the Lands dial does", () => {
  const at = (actual: number) => ({ lands: { actual, target: 39 }, colors: [], castability: { cards: [] } }) as never;
  const { unmount } = render(<ManaGlance deckMath={at(37)} landCount={37} deckSize={100} />);
  const near = screen.getAllByTestId("mana-tile")[0]!;
  expect(near).toHaveTextContent("wants 39: 2 under, within the normal ±3");
  expect(near).toHaveTextContent(bandState(37, 39).label);
  expect(near.className).not.toMatch(/border-\(--warning\)/);
  unmount();
  render(<ManaGlance deckMath={at(34)} landCount={34} deckSize={100} />);
  const far = screen.getAllByTestId("mana-tile")[0]!;
  expect(far).toHaveTextContent("wants 39: 5 under");
  expect(far.className).toMatch(/border-\(--warning\)/);
});

test("when some sources come too late, the tile says how many of the deck's are there in time", () => {
  const dm = { ...(deckMath as object), colors: [{ color: "B", supplied: 38, worst: { pips: 3, turn: 3, required: 37, requiredRaw: 37, cards: 2, available: 30 } }] } as never;
  render(<ManaGlance deckMath={dm} landCount={37} deckSize={100} />);
  // ENOUGH, BUT NOT IN TIME (persona round 2026-10-07): the verdict the Improve finding gives.
  expect(screen.getAllByTestId("mana-tile")[1]).toHaveTextContent(/30 of 37 neededEnough black, but not in time: you run 38 black sources and only 30 can tap by turn 3 \(tapped lands, and rocks you couldn't have cast yet, don't count\)\. 2 cards wanting.*need 37 by turn 3\.$/);
});
