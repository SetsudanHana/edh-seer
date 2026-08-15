import { expect, test } from "vitest";
import { actionScaling, scalingSubject } from "./scaling.js";

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

// MENTIONING A GRAVEYARD IS NOT COUNTING ONE. The catch-all `\bgraveyards?\b` alternative matched any
// object naming a graveyard at all, so 3 of the 17 per-graveyard payoffs in the derived corpus were
// not counting one: Stonespeaker Crystal EXILES "any number of target players' graveyards", and
// Glimpse the Impossible counts "each card put INTO your graveyard this way" — its own exiled cards,
// not the graveyard's contents. A false basis is read as true by impact.ts, buckets.ts and wincon.ts.
test("a graveyard has to be COUNTED, not merely named", () => {
  expect(actionScaling({ verb: "exile", object: "any number of target players' graveyards" })).toBeUndefined();
  expect(actionScaling({ verb: "create", amount: "1 for each card put into your graveyard this way",
    object: "0/1 colorless Eldrazi Spawn creature token" })).toBeUndefined();
  // Still counted when the count really is of a graveyard's contents, in any owner's.
  expect(actionScaling({ verb: "modify-pt", amount: "number of creature cards in all graveyards" })).toBe("per-graveyard");
  expect(actionScaling({ verb: "add-mana", amount: "for each card named Rite of Flame in each graveyard" })).toBe("per-graveyard");
});

// WHAT IS COUNTED IS NOT THE BASIS. Cavalier of Flame counts LAND cards, Glamdring instants and
// sorceries, Bonehoard creatures — all `per-graveyard`. An edge drawn off the basis alone would say
// that milling any card feeds all three, so the counted subject is derived beside it.
test("the counted subject carries the type and whose graveyard", () => {
  expect(scalingSubject({ verb: "deal-damage", amount: "X, where X is the number of land cards in your graveyard" }))
    .toMatchObject({ type: "land", zone: "graveyard", control: "you" });
  expect(scalingSubject({ verb: "modify-pt", amount: "number of creature cards in all graveyards" }))
    .toMatchObject({ type: "creature", zone: "graveyard", control: "any" });
  // "their graveyard" is an OPPONENT's — Riverchurn Monument mills each target player for the size
  // of THEIR yard, which your own fillers do not feed.
  expect(scalingSubject({ verb: "mill", amount: "cards equal to the number of cards in their graveyard" }))
    .toMatchObject({ zone: "graveyard", control: "opp" });
  // No count, no subject.
  expect(scalingSubject({ verb: "draw", amount: "2" })).toBeUndefined();
});
