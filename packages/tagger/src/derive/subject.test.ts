import { expect, test } from "vitest";
import { parseSubject } from "./subject.js";

test("control comes from the possessive phrase, defaulting to any", () => {
  expect(parseSubject("a creature you control").control).toBe("you");
  expect(parseSubject("each creature your opponents control").control).toBe("opp");
  expect(parseSubject("target opponent").control).toBe("opp");
  expect(parseSubject("target creature").control).toBe("any");
});

test("a subject with no card type is a player — the absence of type IS the encoding", () => {
  // Zulaport Cutthroat's drain subject is {control:"opp", token:null} with no type at all.
  expect(parseSubject("each opponent")).toEqual({ control: "opp", token: null, scope: "each" });
  expect(parseSubject("you")).toEqual({ control: "you", token: null });
});

test("card types are recognised singular and plural", () => {
  expect(parseSubject("target creature").type).toBe("creature");
  expect(parseSubject("creatures you control").type).toBe("creature");
  expect(parseSubject("target artifact or enchantment").type).toEqual(["artifact", "enchantment"]);
  expect(parseSubject("target nonland permanent").type).toBe("permanent");
});

test("token is tri-state and always explicit", () => {
  expect(parseSubject("a creature token you control").token).toBe(true);
  expect(parseSubject("a nontoken creature you control").token).toBe(false);
  expect(parseSubject("target creature").token).toBeNull();
});

test("negated control flips you-control to opp, not any", () => {
  expect(parseSubject("target creature you don't control").control).toBe("opp");
  expect(parseSubject("target creature you don’t control").control).toBe("opp");
  // guard: the positive case must still work once negation is checked first.
  expect(parseSubject("creatures you control").control).toBe("you");
});

test("negated token phrasing is recognised alongside nontoken", () => {
  expect(parseSubject("target creature that isn't a token").token).toBe(false);
  expect(parseSubject("target creature that is not a token").token).toBe(false);
  // guard: the positive case must still work.
  expect(parseSubject("a creature token you control").token).toBe(true);
});

test("scope separates spot removal from a wipe, and a pump from an anthem", () => {
  expect(parseSubject("target creature").scope).toBe("target");
  expect(parseSubject("each creature your opponents control").scope).toBe("each");
  expect(parseSubject("all creatures").scope).toBe("all");
  // A bare plural is a mass effect even with no explicit quantifier: this is the anthem case.
  expect(parseSubject("creatures you control").scope).toBe("all");
  // A bare singular says nothing about scope; leave it unset rather than guessing.
  expect(parseSubject("a creature").scope).toBeUndefined();
});

test("umbrella nouns (spell, permanent) yield to a concrete type once one is named", () => {
  // matcher's PSEUDO_TYPE_SETS.spell is every card type except land, so collecting "spell" alongside
  // "instant"/"sorcery" made pairReasons claim any nonland card supplies an instant/sorcery cast.
  expect(parseSubject("instant or sorcery spell").type).toEqual(["instant", "sorcery"]);
  // With no concrete type present, "spell" is all there is, and must still stand for it.
  expect(parseSubject("target spell").type).toBe("spell");
});

test("numeric conditions written in the object text survive as StatPredicates", () => {
  // Without this the compass's power-matters category cannot tell Welcoming Vampire's gated
  // trigger from any unconditional ETB payoff -- the linking tag is identical.
  expect(parseSubject("other creatures you control with power 2 or less").stats)
    .toEqual([{ metric: "power", op: "lte", value: 2 }]);
  expect(parseSubject("a creature with toughness 4 or greater").stats)
    .toEqual([{ metric: "toughness", op: "gte", value: 4 }]);
  expect(parseSubject("target creature").stats).toBeUndefined();
});
