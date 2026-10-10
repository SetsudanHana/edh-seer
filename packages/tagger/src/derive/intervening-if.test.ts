import { expect, test } from "vitest";
import { conditionCares, interveningIfOf } from "./intervening-if.js";

// THE DEMAND A CONDITION MAKES ON THE DECK (owner's framing, 2026-08-20). A closed map, never an
// evaluator: the 2026-08-15 refusal stands for the 241 distinct conditions the corpus prints.
test("a condition contributes the cares tag its text names, and nothing else", () => {
  expect(conditionCares("it had one or more counters on it")).toEqual(["counter-added:any"]);
  expect(conditionCares("a creature died this turn")).toEqual(["dies:creature"]);
  expect(conditionCares("you attacked this turn")).toEqual(["attacks:creature"]);
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

// RECALL v5 #179 (2026-09-10): Scalding Tarn -> Brass's Tunnel-Grinder. "At the beginning of your
// end step, if you descended this turn" is an intervening if, and an intervening if forms no edge
// (owner 2026-08-20) -- but it says what the deck needs. CR 700.11: a player descended when a
// permanent card was put into their graveyard FROM ANYWHERE this turn, so every fill family is the
// demand: a death from the battlefield, a mill, a discard, and enters-graveyard for the rest.
test("'you descended this turn' cares about permanents hitting your graveyard from anywhere (CR 700.11)", () => {
  const all = ["dies:permanent", "mill:any", "discard:any", "enters-graveyard:any"];
  expect(conditionCares("you descended this turn")).toEqual(all);
  expect(conditionCares("you've descended this turn")).toEqual(all);
  expect(conditionCares("you descended four or more times this turn")).toEqual(all);
});

/** OWNER, 2026-09-29: the life you gained and the spells you cast this turn are demands a deck
 *  supplies. Resplendent Angel (Hatsune Miku precon) never showed among token makers that care
 *  about lifegain. "The player with the most life" still names nothing a card supplies. */
test("a turn's lifegain and spells cast are demands; the most-life comparison is not", () => {
  expect(conditionCares("you gained 5 or more life this turn")).toEqual(["gain-life:any"]);
  expect(conditionCares("you gained life this turn")).toEqual(["gain-life:any"]);
  expect(conditionCares("you have at least 7 life more than your starting life total")).toEqual(["gain-life:any"]);
  expect(conditionCares("you have 40 or more life")).toEqual(["gain-life:any"]);
  expect(conditionCares("you've cast a noncreature spell this turn")).toEqual(["cast:-creature"]);
  expect(conditionCares("you've cast two or more instant and/or sorcery spells this turn")).toEqual(["cast:instant", "cast:sorcery"]);
  expect(conditionCares("you have the most life or are tied for most life")).toEqual([]);
  expect(conditionCares("you cast it")).toEqual([]);
});
