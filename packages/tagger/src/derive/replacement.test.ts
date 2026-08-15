import { expect, test } from "vitest";
import { replacementOf } from "./replacement.js";

test("a multiplier is read as the event it MODIFIES, never as one it performs", () => {
  // Hardened Scales. The card places no counter of its own; it changes how many are placed.
  const r = replacementOf("If one or more +1/+1 counters would be put on a creature you control, "
    + "that many plus one +1/+1 counters are put on it instead.");
  expect(r?.verbs).toEqual(["counter-added"]);
  expect(r?.subjectText).toBe("a creature you control");
  expect(r?.counter).toBe("+1/+1");
});

test("each measured template", () => {
  // Xorn — tokens.
  expect(replacementOf("If you would create one or more Treasure tokens, instead create those "
    + "tokens plus an additional Treasure token.")?.verbs).toEqual(["create-token"]);
  // Gratuitous Violence — damage, both halves, because the printed word says only "damage". The
  // subject is what damage is dealt TO: an emit's subject is the action's object, so comparing the
  // source phrase against it would compare a dealer with a victim and match nothing.
  const gv = replacementOf("If a creature you control would deal damage to a permanent or player, "
    + "it deals double that damage instead.");
  expect(gv?.verbs).toEqual(["combat-damage", "non-combat-damage"]);
  expect(gv?.subjectText).toBe("a permanent or player");
  // Bruvac the Grandiloquent — mill.
  expect(replacementOf("If an opponent would mill one or more cards, they mill twice that many "
    + "cards instead.")?.verbs).toEqual(["mill"]);
  // Tekuthal — the prompt's own worked example of this shape.
  expect(replacementOf("If you would proliferate, proliferate twice instead.")?.kind)
    .toBe("trigger-doubling");
});

test("the kind names the multiplication, which is what the product code counts", () => {
  // wincon.ts REQUIRES token-doubling for its go-wide class; buckets.ts and mechanisms.ts read the
  // others. Deriving `token-generation` here said the card makes tokens on its own, which is false.
  expect(replacementOf("If you would create one or more Treasure tokens, instead create those "
    + "tokens plus an additional Treasure token.")?.kind).toBe("token-doubling");
  expect(replacementOf("If a source you control would deal noncombat damage to an opponent, it "
    + "deals double that damage instead.")?.kind).toBe("damage-multiplier");
});

test("a restriction the emit cannot check is LABEL-ONLY, never an edge", () => {
  // Gratuitous Violence doubles damage from A CREATURE YOU CONTROL, so a burn spell is not doubled —
  // and a damage emit's subject is the victim, so nothing downstream could check it. The kind is
  // still true and the classifiers want it; the consumer trigger is what gets withheld.
  expect(replacementOf("If a creature you control would deal damage to a permanent or player, it "
    + "deals double that damage instead.")?.restricted).toBe(true);
  // Bruvac doubles only what an OPPONENT mills; your own self-mill is not it.
  expect(replacementOf("If an opponent would mill one or more cards, they mill twice that many "
    + "cards instead.")?.restricted).toBe(true);
  // "A source you control" is every source your deck has, so it restricts nothing the engine sees.
  expect(replacementOf("If a source you control would deal damage to a permanent or player, it "
    + "deals triple that damage instead.")?.restricted).toBeUndefined();
  // A counter template has no such half at all: "would be put on X" is passive and X is exactly the
  // half a counter-added emit records.
  expect(replacementOf("If one or more +1/+1 counters would be put on a creature you control, "
    + "twice that many +1/+1 counters are put on it instead.")?.restricted).toBeUndefined();
});

test("no INSTEAD, no replacement", () => {
  // Angel of Suffering really does mill: "prevent that damage AND mill twice that many cards" is a
  // prevention plus an action, not a modified mill. The word `instead` is what CR 614 hangs on.
  expect(replacementOf("If damage would be dealt to you, prevent that damage and mill twice that "
    + "many cards.")).toBeNull();
  // An ordinary counter placement is untouched — The Earth Crystal's third clause.
  expect(replacementOf("Distribute two +1/+1 counters among one or two target creatures you control."))
    .toBeNull();
  // A replacement this table has no template for is refused rather than guessed at. Leyline of the
  // Void exiles what would go to a graveyard: a replacement, but not a MULTIPLIER, and its exile is
  // an event it really performs.
  expect(replacementOf("If a card would be put into an opponent's graveyard from anywhere, exile "
    + "it instead.")).toBeNull();
});
