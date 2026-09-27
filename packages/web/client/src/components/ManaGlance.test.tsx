import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
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
  expect(lands).toHaveTextContent("Lands34wants 37: 3 short");
  expect(colour).toHaveTextContent("Weakest colour");
  expect(colour).toHaveTextContent("13/17sources by turn 2, for a card wanting");
  expect(hands).toHaveTextContent(/Opening hands\d+%have 2 to 4 lands/);
  expect(mana).toHaveTextContent("Mana52%to make 6 mana by turn 6");
  expect(cast).toHaveTextContent("Hardest cast48%Dire Fleet Ravager on turn 5");
});

test("a deck short of nothing says so", () => {
  const fine = { lands: { actual: 37, target: 37 }, colors: [{ color: "G", supplied: 30 }], castability: { cards: [] } } as never;
  render(<ManaGlance deckMath={fine} landCount={37} deckSize={100} />);
  expect(screen.getByText("wants 37: on target")).toBeInTheDocument();
  expect(screen.getByText("enough sources for every card")).toBeInTheDocument();
});
