import { expect, test } from "vitest";
import { actionScaling } from "./scaling.js";

test("a count in the action's own amount names the basis it counts", () => {
  // flat carried effect.scaling on 1,781 cards; derived carried it on ZERO, so flipping TAGS_SOURCE
  // to derived took the whole scaling channel dark -- edges.ts copies it onto every Reason and
  // impact.ts weights by it.
  expect(actionScaling({ verb: "add-mana", amount: "for each creature you control with defender" })).toBe("per-creature");
  expect(actionScaling({ verb: "add-mana", amount: "for each artifact you control" })).toBe("per-permanent");
  expect(actionScaling({ verb: "lose-life", amount: "the number of creatures with defender you control" })).toBe("per-creature");
  expect(actionScaling({ verb: "deal-damage", amount: "X", object: "any target" })).toBe("x-cost");
});

test("a graveyard count is per-graveyard even when it counts creatures", () => {
  // Diregraf Colossus. "per-graveyard-creature" is a SCALING_ALIASES entry pointing at per-graveyard,
  // so the graveyard reading is the canonical one and must be tested before per-creature.
  expect(actionScaling({ verb: "add-counter", amount: "for each Zombie card in your graveyard" })).toBe("per-graveyard");
  expect(actionScaling({ verb: "modify-pt", amount: "+1/+1 for each creature card in your graveyard" })).toBe("per-graveyard");
});

test("counting players is per-opponent", () => {
  expect(actionScaling({ verb: "create", amount: "for each opponent" })).toBe("per-opponent");
  expect(actionScaling({ verb: "draw", amount: "the number of players in the game" })).toBe("per-opponent");
});

test("a count the vocabulary cannot name stays unset", () => {
  // Dragonspark Reactor counts charge counters on itself; SCALING_BASES has no member for it, and a
  // near-miss basis is consumed as if it were true while unset means "fixed", the honest default.
  expect(actionScaling({ verb: "deal-damage", amount: "the number of charge counters on this artifact" })).toBeUndefined();
  expect(actionScaling({ verb: "draw", amount: "2" })).toBeUndefined();
  expect(actionScaling({ verb: "draw" })).toBeUndefined();
});

test("only the action's OWN text is read, never the clause's", () => {
  // "Draw a card for each creature you control, then create a Treasure token" -- the count belongs to
  // the draw. Reading the clause would make the Treasure per-creature too, the same cross-action
  // bleed the recipient cue table is bounded to avoid. 221 actions carry the count in their own
  // amount or object; the 329 clause-only mentions are deliberately out of reach.
  expect(actionScaling({ verb: "create", object: "a Treasure token" })).toBeUndefined();
});
