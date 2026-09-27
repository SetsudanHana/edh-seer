import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { buildEngineModel } from "../lib/engine-model.js";
import { BracketPanel } from "./BracketPanel.js";
import { SkyContext } from "./DeckSky.js";

/** THE BRACKET ON THE DECK'S SKY (owner, 2026-09-27): its Game Changers lit, each infinite combo a
 *  closed gold loop; a combo row picks that one out. */
test("what puts the deck in its bracket is lit on the sky, each combo as a loop", () => {
  const { report, graph } = engineDeck();
  const { container } = render(
    <SkyContext.Provider value={buildEngineModel(report, graph)}>
      <BracketPanel
        bracket={{ band: "4-5", gameChangers: ["Reducer"], infiniteCombos: 2, cheapCombos: [], reasons: [] }}
        combos={[
          { cards: ["Payoff A", "Payoff B"], result: "Infinite mana" },
          { cards: ["Cleric 1", "Cleric 2", "Payoff A"], result: "Infinite damage" },
        ]}
      />
    </SkyContext.Provider>,
  );
  // Both combos run through Payoff A, and the sky says so rather than promising two loops.
  expect(screen.getByText(/^What puts it in bracket 4–5: the 1 Game Changer and the 2 infinite combos in gold, all through Payoff A, so they overlap: pick one above to see it alone\.$/)).toBeInTheDocument();
  // A two-card loop is one line; a three-card loop is three.
  expect(container.querySelectorAll("[data-testid=sky-lit-lines] line").length).toBe(4);
  fireEvent.click(screen.getAllByRole("button", { name: "Show this one on the sky" })[1]!);
  expect(screen.getByText(/^What puts it in bracket 4–5: Cleric 1 \+ Cleric 2 \+ Payoff A, drawn as its loop in gold\.$/)).toBeInTheDocument();
  expect(container.querySelectorAll("[data-testid=sky-lit-lines] line").length).toBe(3);
});
