import { expect, test } from "vitest";
import { emblemRecipient, GETS_AN_EMBLEM, hasEmblemPart, isEmblemPart } from "./emblem.js";

/** THE EMBLEM IS AN OBJECT IN SCRYFALL (checked 2026-09-08): the granting card's `allParts` names it
 *  as a `combo_piece` whose type line starts with "Emblem". A `combo_piece` pointing at a real card
 *  is what the token path excludes, and it stays excluded here. */
test("an Emblem combo_piece is an emblem part; a card combo_piece and a token part are not", () => {
  expect(isEmblemPart({ component: "combo_piece", typeLine: "Emblem — Chandra" })).toBe(true);
  expect(isEmblemPart({ component: "combo_piece", typeLine: "Legendary Creature — Human" })).toBe(false);
  expect(isEmblemPart({ component: "token", typeLine: "Token Creature — Wizard" })).toBe(false);
  expect(isEmblemPart({ component: "combo_piece" })).toBe(false);
  expect(hasEmblemPart([{ component: "combo_piece", typeLine: "Card" }, { component: "combo_piece", typeLine: "Emblem — Chandra" }])).toBe(true);
  expect(hasEmblemPart(undefined)).toBe(false);
});

test("the cue matches the printed grant and nothing wider", () => {
  expect(GETS_AN_EMBLEM.test("You get an emblem with \"Creatures you control get +1/+1.\"")).toBe(true);
  expect(GETS_AN_EMBLEM.test("Each player dealt damage this way gets an emblem with \"At the beginning of your upkeep, this emblem deals 3 damage to you.\"")).toBe(true);
  expect(GETS_AN_EMBLEM.test("Create a 2/2 Zombie creature token.")).toBe(false);
});

/** WHO GETS IT (CR 114.2: the emblem is owned and controlled by that player). Read off the
 *  sentence, because the clause object usually says only "an emblem". Measured over the 86 emblem
 *  clauses in the corpus: three shapes give it to someone else. "Target player" counts as ours, for
 *  the reason a plain "create" does in `createsForYou`: the ordinary case is pointing it at yourself. */
test("the recipient is you unless the sentence hands it to an opponent", () => {
  expect(emblemRecipient("You get an emblem with \"Creatures you control get +2/+2 and have flying.\"")).toBe("you");
  expect(emblemRecipient("−7: Chandra deals 6 damage to each opponent. Each player dealt damage this way gets an emblem with \"At the beginning of your upkeep, this emblem deals 3 damage to you.\"")).toBe("opp");
  expect(emblemRecipient("−8: Target opponent gets an emblem with \"Whenever a creature attacks you, it gets +5/+5 and gains trample until end of turn.\"")).toBe("opp");
  expect(emblemRecipient("−8: Target player gets an emblem with \"Whenever you cast a spell, copy it.\"")).toBe("you");
  expect(emblemRecipient("Each opponent gets an emblem with \"You can't cast noncreature spells.\"")).toBe("opp");
});
