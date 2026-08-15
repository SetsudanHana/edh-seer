import { expect, test } from "vitest";
import { thresholdFor, thresholdSubjectFor } from "./threshold.js";

test("a counter threshold on a trigger is recorded", () => {
  // The Millennium Calendar: "When there are 1,000 or more time counters on The Millennium
  // Calendar, sacrifice it and each opponent loses 1,000 life."
  expect(thresholdFor(
    "When there are 1,000 or more time counters on The Millennium Calendar, sacrifice it and each opponent loses 1,000 life.",
  )).toEqual({ atLeast: 1000 });
});

test("a THOUSANDS SEPARATOR is part of the number, not a boundary", () => {
  // The bug this test exists for: \b\d+\b matches "000" in "1,000 or more" because the word
  // boundary sits after the comma, so the threshold derives as 0 -- a witness worse than the
  // missing field it replaces. Spec section 6.1.1.
  expect(thresholdFor("When there are 1,000 or more time counters on it, you win the game.")).toEqual({ atLeast: 1000 });
  expect(thresholdFor("When there are 1,000 or more time counters on it, you win the game.")?.atLeast).not.toBe(0);
});

test("a word number is recorded", () => {
  // Cabal Ritual: "Threshold -- Add {B}{B}{B}{B}{B} instead if there are seven or more cards in
  // your graveyard."
  expect(thresholdFor("Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard."))
    .toEqual({ atLeast: 7 });
});

test("'at least N' is the same fact as 'N or more'", () => {
  expect(thresholdFor("Adamant -- If at least three colorless mana was spent to cast this spell, draw a card."))
    .toEqual({ atLeast: 3 });
});

test("'or greater' is the same fact as 'or more'", () => {
  // SYNTHETIC string, not a card: "or greater" is the comparator spelling the corpus uses on stat
  // comparisons (Colfenor's Urn, Betor), and this pins that the non-stat path accepts it too.
  // Do not attribute altered text to a real card -- a card's printed wording is corpus data.
  expect(thresholdFor("At the beginning of your end step, if you control eight or greater Islands, draw a card."))
    .toEqual({ atLeast: 8 });
});

test("EXCLUSION 1: 'one or more' is not a threshold, it means any", () => {
  // Welcoming Vampire: "Whenever one or more other creatures you control with power 2 or less
  // enter, draw a card." An English plural, not a counted condition. 98 of 208 corpus matches.
  expect(thresholdFor("Whenever one or more other creatures you control enter, draw a card.")).toBeUndefined();
});

test("EXCLUSION 2: a stat comparison belongs to SubjectFilter.stats", () => {
  // Bolt Bend: "This spell costs {3} less to cast if you control a creature with power 4 or
  // greater." SubjectFilter.stats already carries this and Reason.hasStatPredicate already reads
  // it; two slots claiming one fact is the collision notType and umbrella exist to prevent.
  expect(thresholdFor("This spell costs {3} less to cast if you control a creature with power 4 or greater.")).toBeUndefined();
  // Colfenor's Urn: "Whenever a creature with toughness 4 or greater is put into your graveyard
  // from the battlefield, you may exile it."
  expect(thresholdFor("Whenever a creature with toughness 4 or greater is put into your graveyard from the battlefield, you may exile it.")).toBeUndefined();
  // Betor, Kin to All -- an aggregate stat is still a stat.
  expect(thresholdFor("At the beginning of your end step, if creatures you control have total toughness 10 or greater, draw a card.")).toBeUndefined();
});

test("a comparison with no condition cue is not a trigger threshold", () => {
  // A bare magnitude in an effect is Ability.amount's business, not a trigger's. Both strings are
  // SYNTHETIC -- they exist to exercise the cue gate, and neither is quoted from a card.
  expect(thresholdFor("Draw three cards.")).toBeUndefined();
  expect(thresholdFor("Put three or more +1/+1 counters on target creature.")).toBeUndefined();
});

test("no comparison at all is refused", () => {
  expect(thresholdFor("Whenever this creature attacks, draw a card.")).toBeUndefined();
  expect(thresholdFor("")).toBeUndefined();
});

test("EXCLUSION 3: a comparison after 'Then' conditions a RIDER, not the trigger", () => {
  // Primal Amulet // Primal Wellspring. The charge counter goes on REGARDLESS of the count --
  // gating the counter-placement at 4 says the card does something it does not do.
  expect(thresholdFor(
    "Whenever you cast an instant or sorcery spell, put a charge counter on this artifact. Then if there are four or more charge counters on it, you may remove those counters and transform it.",
  )).toBeUndefined();
});

test("EXCLUSION 3: a comparison in a LATER SENTENCE is a rider even without 'Then'", () => {
  // Omnath, Locus of the Roil. The +1/+1 counter is unconditional; only the draw is gated.
  expect(thresholdFor(
    "Landfall — Whenever a land you control enters, put a +1/+1 counter on target Elemental you control. If you control eight or more lands, draw a card.",
  )).toBeUndefined();
});

test("EXCLUSION 3 keeps a first-sentence threshold, which is the shape that IS the trigger", () => {
  // The Millennium Calendar -- the whole point of the field. The condition is the trigger itself,
  // not a rider on a later clause, so it must survive all three exclusions.
  expect(thresholdFor(
    "When there are 1,000 or more time counters on The Millennium Calendar, sacrifice it and each opponent loses 1,000 life.",
  )).toEqual({ atLeast: 1000 });
});

test("the FIRST qualifying comparison wins when a sentence carries two", () => {
  // Twenty-Toed Toad: "Whenever this creature attacks, you win the game if there are twenty or
  // more counters on it or you have twenty or more life." An OR across two different resources;
  // one atLeast records the count and loses which resource it applies to. Stated ceiling, spec
  // section 10 -- B must not assume the threshold's subject is the trigger's subject.
  expect(thresholdFor(
    "Whenever this creature attacks, you win the game if there are twenty or more counters on it or you have twenty or more life.",
  )).toEqual({ atLeast: 20 });
});

// A NUMBER WITHOUT ITS NOUN CLAIMS EVERYTHING — the same lesson `scalingSubject` learned for
// per-graveyard counts. Revel in Riches derives atLeast:10 and an UNTYPED subject, so the engine
// knows the number and not that it counts TREASURES. Measured: only 1 of the 10 win-game cards in
// the 71 decks names anything at all.
test("a threshold carries the noun it counts", () => {
  expect(thresholdSubjectFor("At the beginning of your end step, if you control ten or more "
    + "Treasures, you win the game.")).toMatchObject({ subtype: "treasure" });
  expect(thresholdSubjectFor("At the beginning of your upkeep, if you control twenty or more "
    + "artifacts, you win the game.")).toMatchObject({ type: "artifact" });
  // No countable noun, no subject — refused rather than guessed, as thresholdFor itself refuses.
  expect(thresholdSubjectFor("At the beginning of your upkeep, if you have exactly thirteen cards "
    + "in your hand, you win the game.")).toBeUndefined();
  // No threshold at all.
  expect(thresholdSubjectFor("Whenever a creature you control dies, draw a card.")).toBeUndefined();
});

// Review finding 1 (Important): `thresholdSubjectFor` used to run its OWN `.exec()` over the raw
// text instead of sharing `thresholdFor`'s match selection, so on a sentence with TWO comparisons it
// could pick a different one -- the noun from an EXCLUDED match, paired with the number from the
// winning one. Persistent Marshstalker's clause text (fetched from the corpus, not retyped):
// "Whenever you attack with one or more Rats, if there are seven or more cards in your graveyard,
// you may pay {2}{B}. If you do, return this card from your graveyard to the battlefield tapped and
// attacking." "one or more Rats" is excluded by #1 (an English plural), "seven or more cards" is the
// real threshold -- the bug paired {atLeast: 7} with {subtype: "rat"}, a number and a noun from two
// different clauses of the sentence.
test("REVIEW FINDING 1: the noun comes from the SAME comparison the number does", () => {
  const text = "Whenever you attack with one or more Rats, if there are seven or more cards in your "
    + "graveyard, you may pay {2}{B}. If you do, return this card from your graveyard to the "
    + "battlefield tapped and attacking.";
  expect(thresholdFor(text)).toEqual({ atLeast: 7 });
  // "cards in your graveyard" is a zone-scoped card count (also finding 2's shape below), not a
  // permanent class, and the number that survives is the graveyard one, not the Rats one -- so this
  // must be undefined, NOT {subtype: "rat"}.
  expect(thresholdSubjectFor(text)).toBeUndefined();
});

// Review finding 2 (Important): the hand/life exclusion was an allow-list of ONE zone ("hand") and
// missed every other zone a card count can name. The Everflowing Well // The Myriad Pools's clause
// text (fetched from the corpus): "Descend 8 — At the beginning of your upkeep, if there are eight
// or more permanent cards in your graveyard, transform The Everflowing Well." The noun "permanent
// cards in your graveyard" used to derive {type: "permanent"} with no zone, which a consumer reads
// as "permanents you control" -- the opposite zone from the one printed.
test("REVIEW FINDING 2: a zone-scoped card count is refused for ANY zone, not just hand", () => {
  const text = "Descend 8 — At the beginning of your upkeep, if there are eight or more permanent "
    + "cards in your graveyard, transform The Everflowing Well.";
  expect(thresholdFor(text)).toEqual({ atLeast: 8 });
  expect(thresholdSubjectFor(text)).toBeUndefined();
});

// Review finding 3 (Important): no self-reference guard ran before the noun was parsed as a type.
// Colfenor's Urn's clause text (fetched from the corpus): "At the beginning of the end step, if
// three or more cards have been exiled with this artifact, sacrifice it. If you do, return those
// cards to the battlefield under their owner's control." The noun "cards have been exiled with this
// artifact" used to derive {type: "artifact"}, reading the Urn itself as the counted class -- the
// self-trigger defect family that has been 74% of this project's false edges, in a new place.
test("REVIEW FINDING 3: a self-referencing noun is refused, not read as a type", () => {
  const text = "At the beginning of the end step, if three or more cards have been exiled with this "
    + "artifact, sacrifice it. If you do, return those cards to the battlefield under their owner's "
    + "control.";
  expect(thresholdFor(text)).toEqual({ atLeast: 3 });
  expect(thresholdSubjectFor(text)).toBeUndefined();
});
