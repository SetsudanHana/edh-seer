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

/** A COUNT OF WHAT IS ON THE BATTLEFIELD, which the corpus states 662 cards' worth of and this
 *  file read none of. Krenko, Mob Boss makes "X 1/1 red Goblin creature tokens, where X is the
 *  number of Goblins you control" and derived NO scaling at all: the bases below him test for
 *  creatures, permanents, artifacts and lands, and "Goblins" is none of those words. */
test("a battlefield count of a subtype is per-permanent, and names what it counts", () => {
  const action = {
    verb: "create",
    object: "X 1/1 red Goblin creature tokens, where X is the number of Goblins you control",
  } as never;
  expect(actionScaling(action)).toBe("per-permanent");
  expect(scalingSubject(action)).toMatchObject({ subtype: "goblin", zone: "battlefield", control: "you" });
});

/** "ON THE BATTLEFIELD" IS EVERYONE'S BOARD, "you control" is yours -- the same owner distinction
 *  the graveyard branch already draws between "your graveyard" and "all graveyards", and it decides
 *  whether an opponent's Goblins count. */
test("the counted owner is read from the phrase", () => {
  const yours = { verb: "draw", object: "a card for each Elf you control" } as never;
  const anyone = { verb: "deal", object: "damage for each Zombie on the battlefield" } as never;
  expect(scalingSubject(yours)?.control).toBe("you");
  expect(scalingSubject(anyone)?.control).toBe("any");
});

/** A GRAVEYARD COUNT STAYS A GRAVEYARD COUNT. The battlefield branch is tested AFTER it, because
 *  "creature cards in your graveyard" mentions neither "you control" nor "the battlefield" and must
 *  not start claiming a board. */
test("a graveyard count is unchanged by the battlefield branch", () => {
  const action = { verb: "deal", object: "damage equal to the number of creature cards in your graveyard" } as never;
  expect(actionScaling(action)).toBe("per-graveyard");
  expect(scalingSubject(action)?.zone).toBe("graveyard");
});

/** A BARE CARD TYPE KEEPS ITS OWN BASIS. "Creatures you control" is `per-creature` and was already
 *  right; the new branch must not overwrite it with per-permanent. */
test("a creature count keeps per-creature", () => {
  expect(actionScaling({ verb: "draw", object: "a card for each creature you control" } as never))
    .toBe("per-creature");
});

/** "WHERE X IS THE NUMBER OF ..." DEFINES X FOR THE CLAUSE, and the own-text rule above still holds:
 *  the count reaches only an action whose amount IS that bare X, never a sibling with a fixed
 *  amount. Burakos, Party Leader: "defending player loses X life and you create X Treasure tokens,
 *  where X is the number of creatures in your party" -- the normalizer keeps the tail on neither
 *  action, so both derived `x-cost` and no subject (owner, 2026-09-05). And "in your party" is a
 *  board count of the four party types (CR 700.7). 43 corpus cards say party. */
test("a clause that defines X hands the count to every action whose amount is X", () => {
  const clause = "Whenever Burakos attacks, defending player loses X life and you create X Treasure tokens, where X is the number of creatures in your party.";
  const life = { verb: "lose-life", object: "defending player", amount: "X" } as never;
  const tokens = { verb: "create", object: "X Treasure tokens", amount: "X" } as never;
  const fixed = { verb: "draw", amount: "1" } as never;
  expect(actionScaling(life, clause)).toBe("per-creature");
  expect(scalingSubject(tokens, clause)).toEqual({
    type: "creature", subtype: ["cleric", "rogue", "warrior", "wizard"], zone: "battlefield", control: "you", token: null,
  });
  expect(actionScaling(fixed, clause)).toBeUndefined();
  // A bare X with no definition in the clause is still the X the player paid.
  expect(actionScaling(tokens, "Create X Treasure tokens.")).toBe("x-cost");
});
