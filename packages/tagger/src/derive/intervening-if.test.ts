import { expect, test } from "vitest";
import { conditionCares, interveningIfOf } from "./intervening-if.js";

// THE DEMAND A CONDITION MAKES ON THE DECK (owner's framing, 2026-08-20). A closed map, never an
// evaluator: the 2026-08-15 refusal stands for the 241 distinct conditions the corpus prints.
test("a condition contributes the cares tag its text names, and nothing else", () => {
  expect(conditionCares("it had one or more counters on it")).toEqual(["counter-added:any"]);
  expect(conditionCares("a creature died this turn")).toEqual(["dies:creature"]);
  expect(conditionCares("you attacked this turn")).toEqual(["attacks:any"]);
  expect(conditionCares("a planeswalker entered the battlefield under your control this turn"))
    .toEqual(["enters:planeswalker"]);

  // DELIBERATE SILENCE. A colour or a life total is a DECK-FIT fact, not a theme any card supplies,
  // so a cares tag would be a category error — Oath of Liliana in a deck with no planeswalkers
  // belongs on the cut list. And "it was kicked" is the residue that got the slot refused.
  expect(conditionCares("you control a red permanent")).toEqual([]);
  expect(conditionCares("no opponent has more life than that player")).toEqual([]);
  expect(conditionCares("it was kicked")).toEqual([]);
});

test("the condition phrase is read off the clause, and non-conditions are refused", () => {
  expect(interveningIfOf("At the beginning of your end step, if a creature died this turn, each opponent loses 1 life."))
    .toBe("a creature died this turn");
  // "if you do" is the follow-up to an optional cost inside the EFFECT, not a condition on the event.
  expect(interveningIfOf("When this creature dies, you may pay {2}. If you do, draw a card.")).toBeNull();
  // A static sentence carries no trigger, so it carries no intervening if.
  expect(interveningIfOf("Creatures you control get +1/+1 if you control an artifact.")).toBeNull();
});
