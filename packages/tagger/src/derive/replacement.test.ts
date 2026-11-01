import { expect, test } from "vitest";
import { damageChangeOf, replacementOf } from "./replacement.js";

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
  // subject is the DEALER: a damage emit records its source (`GameEvent.dealer`) and the matcher
  // compares a damage trigger against it, so the source phrase is the checkable half (v4 #120).
  const gv = replacementOf("If a creature you control would deal damage to a permanent or player, "
    + "it deals double that damage instead.");
  expect(gv?.verbs).toEqual(["combat-damage", "non-combat-damage"]);
  expect(gv?.subjectText).toBe("a creature you control");
  // Fiery Emancipation: "a source you control" is every source, which `parseSubject` reads as a
  // typeless `{control: you}` -- the shape Khalni Ambush's fight dealer carries.
  expect(replacementOf("If a source you control would deal damage to a permanent or player, it "
    + "deals triple that damage instead.")?.subjectText).toBe("a source you control");
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
  // and since the dealer is the subject, that is a `creature` demand the matcher checks itself, so
  // it is no longer withheld (v4 #120).
  expect(replacementOf("If a creature you control would deal damage to a permanent or player, it "
    + "deals double that damage instead.")?.restricted).toBeUndefined();
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

/** #717: a draw DOUBLER is a payoff for draws; a draw REPLACED by something else is not. */
test("a draw doubler is a draw replacement; dredge and Laboratory Maniac are not", () => {
  expect(replacementOf("If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead.")?.verbs).toEqual(["draw"]);
  expect(replacementOf("As long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that many cards plus one instead.")?.verbs).toEqual(["draw"]);
  expect(replacementOf("If you would draw a card, you may mill three cards instead. If you do, return this card from your graveyard to your hand.")).toBeNull();
  expect(replacementOf("If you would draw a card while your library has no cards in it, you win the game instead.")).toBeNull();
  expect(replacementOf("If you would draw a card, instead look at the top three cards of your library, then put one into your hand and the rest into your graveyard.")).toBeNull();
});

// #858: the passive frame ("tokens would be created") and "an effect would create" are the same CR 614
// token multiplier as Xorn's "you would create". Printed text, 2026-09-30.
test("a token multiplier in the passive, or with an effect as its actor", () => {
  const stride = replacementOf("If one or more artifact tokens would be created under your control, those tokens plus an additional 1/1 colorless Thopter artifact creature token with flying are created instead.");
  expect(stride).toMatchObject({ verbs: ["create-token"], kind: "token-doubling", subjectText: "one or more artifact tokens" });
  expect(replacementOf("If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.")?.kind).toBe("token-doubling");
  // Without "instead" it is not a replacement at all.
  expect(replacementOf("Whenever one or more artifact tokens are created under your control, draw a card.")).toBeNull();
});

/** A TOKEN LIST IS READ WHOLE (#794): Academy Manufactor's "a Clue, Food, or Treasure token" was cut
 *  at its first comma, and Treasure makers never met it. */
test("a token replacement keeps every token its phrase names, and 'under your control'", () => {
  expect(replacementOf("If you would create a Clue, Food, or Treasure token, instead create one of each.")?.subjectText).toBe("a Clue, Food, or Treasure token");
  expect(replacementOf("If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.")?.subjectText).toBe("one or more tokens under your control");
});

test("a token replacement says HOW it multiplies (#1136)", () => {
  const mode = (t: string) => replacementOf(t)?.tokenMultiplier;
  expect(mode("If you would create one or more Treasure tokens, instead create those tokens plus an additional Treasure token.")).toBe("additional");
  expect(mode("If one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead.")).toBe("additional");
  expect(mode("If you would create a Food token, instead create a Food token and a Treasure token.")).toBe("additional");
  expect(mode("If you would create a Clue, Food, or Treasure token, instead create one of each.")).toBe("one-of-each");
  expect(mode("If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.")).toBe("twice");
  expect(mode("If one or more creature tokens would be created under your control, three times that many of those tokens are created instead.")).toBe("thrice");
  // The same count, a different token: not a multiplier.
  expect(mode("If one or more creature tokens would be created under your control, that many 4/4 white Angel creature tokens with flying and vigilance are created instead.")).toBe("replaced");
  expect(mode("If you would create one or more tokens, you may instead create that many 2/2 green Cat creature tokens with haste or that many 3/1 green Dog creature tokens with vigilance.")).toBe("replaced");
  // Only the token family carries it.
  expect(mode("If an opponent would mill one or more cards, they mill twice that many cards instead.")).toBeUndefined();
});

/** WHAT THE REPLACEMENT DOES TO THE EVENT (owner, 2026-10-24: "fix the derive so it can catch the
 *  amount on replacement effects"). Printed texts from the committed fixtures, not from memory. */
test("a replacement says how it changes the event: adds N, or multiplies by N", () => {
  const change = (t: string) => replacementOf(t)?.change;
  // Fiery Emancipation, Anointed Procession, Tekuthal.
  expect(change("If a source you control would deal damage to a permanent or player, it deals triple that damage to that permanent or player instead.")).toEqual({ op: "times", value: 3 });
  expect(change("If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.")).toEqual({ op: "times", value: 2 });
  expect(change("If you would proliferate, proliferate twice instead.")).toEqual({ op: "times", value: 2 });
  expect(change("If a Wizard you control would deal damage to a permanent or player, it deals double that damage instead.")).toEqual({ op: "times", value: 2 });
  // Pyromancer's Gauntlet's template, Hardened Scales, Xorn.
  expect(change("If a red instant or sorcery spell you control would deal damage to a permanent or player, it deals that much damage plus 2 to that permanent or player instead.")).toEqual({ op: "plus", value: 2 });
  expect(change("If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.")).toEqual({ op: "plus", value: 1 });
  expect(change("If you would create one or more Treasure tokens, instead create those tokens plus an additional Treasure token.")).toEqual({ op: "plus", value: 1 });
  // The counter kind is optional (any kind), and the ACTIVE frame is a template of its own (Winding Constrictor, Pir, Dr. M'Benga, Doubling Season, Loading Zone).
  expect(change("If one or more counters would be put on an artifact or creature you control, that many plus one of each of those kinds of counters are put on that permanent instead.")).toEqual({ op: "plus", value: 1 });
  expect(change("If you would put one or more counters on a creature you control, put twice that many of each of those kinds of counters on that creature instead.")).toEqual({ op: "times", value: 2 });
  expect(change("If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.")).toEqual({ op: "times", value: 2 });
  expect(replacementOf("If one or more counters would be put on a creature, Spacecraft, or Planet you control, twice that many of each of those kinds of counters are put on it instead.")?.subjectText).toBe("a creature, Spacecraft, or Planet you control");
  expect(replacementOf("If one or more counters would be put on an artifact or creature you control, that many plus one of each of those kinds of counters are put on that permanent instead.")?.counter).toBeUndefined();
  // ...and an effect's counters are everyone's, an opponent's are a restricted half.
  expect(replacementOf("If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.")?.restricted).toBeUndefined();
});

/** NO NUMBER, NO CHANGE: a count that is itself variable is not a size the filter can compare. */
test("a change the sentence does not state as a number is left unset", () => {
  // Chatterfang's shape: "plus that many" adds a variable count.
  expect(replacementOf("If one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead.")?.change).toBeUndefined();
  // Alhammarret's Archive: a different event count, not a multiple of "that many".
  expect(replacementOf("If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead.")?.change).toBeUndefined();
});

/** WHAT A DAMAGE REPLACEMENT DOES (#1345): the sentence said "doubles the damage" of every
 *  `damage-multiplier`. Printed texts from the corpus (Mongo, 2026-11-01). */
test("a damage replacement says how it changes the damage", () => {
  const how = (t: string) => damageChangeOf(t);
  expect(how("If a source you control would deal damage to a permanent or player, it deals triple that damage to that permanent or player instead.")).toBe("thrice");
  expect(how("If a creature you control would deal damage to a permanent or player, it deals double that damage instead.")).toBe("twice");
  expect(how("Double all damage that creatures you control with counters on them would deal.")).toBe("twice");
  expect(how("If a creature you control that entered this turn would deal damage, it deals twice that much damage instead.")).toBe("twice");
  expect(how("If a source would deal damage to a player or battle this turn, it deals that much damage plus 2 instead.")).toBe("plus");
  expect(how("If a source you control would deal noncombat damage to a permanent or player this turn, it deals that much damage plus X instead.")).toBe("plus");
  expect(how("If a source would deal damage to a permanent or player, it deals half that damage, rounded down, to that permanent or player instead.")).toBe("reduced");
  expect(how("If a spell would deal damage to a permanent or player, it deals that much damage minus 1 to that permanent or player instead.")).toBe("reduced");
  // Not a multiplier at all: a redirect, a mill, a counter, a fixed number.
  expect(how("If a Zombie you control would deal combat damage to a player, instead that player mills that many cards.")).toBe("other");
  expect(how("If a source would deal 4 or more damage to a permanent or player, that source deals 3 damage to that permanent or player instead.")).toBe("other");
  expect(how("")).toBeUndefined();
});
