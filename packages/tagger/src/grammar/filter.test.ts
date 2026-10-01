/** The filter grammar (#896 task 2). Every phrase here is one the stored clauses print — each is a
 *  line of `packages/tagger/phrases.jsonl`, not a sentence written for the test. */
import { expect, test } from "vitest";
import { parse, lex } from "./filter.js";

test("card types, OR-lists and the umbrella noun a concrete type narrows", () => {
  expect(parse("an instant or sorcery spell")).toEqual({ control: "any", token: null, type: ["instant", "sorcery"] });
  expect(parse("target creature or planeswalker")).toMatchObject({ type: ["creature", "planeswalker"], scope: "target" });
  expect(parse("Artifacts, creatures, and lands your opponents control")).toMatchObject({ type: ["creature", "artifact", "land"], control: "opp", scope: "all" });
});

test("a compound noun is both types; two umbrellas narrow each other", () => {
  expect(parse("other artifact creatures you control")).toMatchObject({ type: ["creature", "artifact"], allTypes: ["artifact", "creature"], other: true, scope: "all", control: "you" });
});

test("negation is resolved to the types it leaves, for a card type, a hyphenated one, and a subtype", () => {
  expect(parse("a noncreature spell")).toMatchObject({ notType: ["creature"], type: ["artifact", "enchantment", "planeswalker", "instant", "sorcery", "battle"] });
  expect(parse("target nonland permanent")).toMatchObject({ notType: ["land"], type: ["creature", "artifact", "enchantment", "planeswalker", "battle"] });
  // parseSubject reads `creature` inside "non-creature" and inverts the card (grammar-triage.json).
  expect(parse("a non-creature card from your graveyard")).toMatchObject({ notType: ["creature"], fromZone: "graveyard" });
  expect(parse("target non-Dragon creature card")).toMatchObject({ type: "creature", notSubtype: ["dragon"] });
});

test("subtypes, plural subtypes, tokens and nontokens", () => {
  expect(parse("Elves you control")).toMatchObject({ subtype: "elf", control: "you", scope: "all" });
  expect(parse("another nontoken creature you control")).toEqual({ control: "you", token: false, type: "creature", other: true });
  expect(parse("a 1/2 blue Bird creature token with flying named Storm Crow")).toEqual({
    control: "any", token: true, type: "creature", subtype: "bird", colors: ["U"], keyword: ["flying"],
    stats: [{ metric: "power", op: "eq", value: 1 }, { metric: "toughness", op: "eq", value: 2 }],
  });
});

test("a type on one side of an OR and a subtype on the other is a cross-slot OR", () => {
  expect(parse("another creature or Vehicle you control")).toMatchObject({ anyOf: [{ type: "creature" }, { subtype: "vehicle" }], control: "you", other: true });
  expect(parse("an artifact or Dragon card")).toMatchObject({ anyOf: [{ type: "artifact" }, { subtype: "dragon" }] });
});

test("colours, stats, keywords and counters", () => {
  expect(parse("a white or blue instant or sorcery spell")).toMatchObject({ colors: ["W", "U"], type: ["instant", "sorcery"] });
  expect(parse("a creature you control with power 2 or less")).toMatchObject({ stats: [{ metric: "power", op: "lte", value: 2 }] });
  expect(parse("target creature card with mana value 3 or less from your graveyard")).toMatchObject({
    type: "creature", stats: [{ metric: "mana-value", op: "lte", value: 3 }], fromZone: "graveyard", control: "you", scope: "target",
  });
  expect(parse("a spell with an odd mana value")).toMatchObject({ stats: [{ metric: "mana-value", op: "odd" }] });
  expect(parse("a 1/1 creature you control")).toMatchObject({ stats: [{ metric: "power", op: "eq", value: 1 }, { metric: "toughness", op: "eq", value: 1 }] });
  expect(parse("creatures you control with flying")).toMatchObject({ keyword: ["flying"] });
  expect(parse("a creature you control without flying")).toMatchObject({ notKeyword: ["flying"] });
  expect(parse("a creature you control with a +1/+1 counter on it")).toMatchObject({ counter: "+1/+1", type: "creature" });
});

test("control, ownership, and who casts", () => {
  expect(parse("target creature an opponent controls")!.control).toBe("opp");
  expect(parse("target creature you don't control")!.control).toBe("opp");
  expect(parse("target creature you own")).toMatchObject({ owner: "you", control: "any" });
  // CR 112.2: a spell's controller is the player who cast it.
  expect(parse("Instant and sorcery spells you cast")).toMatchObject({ control: "you", type: ["instant", "sorcery"] });
  expect(parse("Spells your opponents cast")!.control).toBe("opp");
});

test("players are subjects too", () => {
  expect(parse("you")).toEqual({ control: "you", token: null });
  expect(parse("each opponent")).toEqual({ control: "opp", token: null, scope: "each" });
  expect(parse("one or more of your opponents")).toBeNull();
});

test("the quantifier: target binds the player in a possessive, not the cards; 'another' is singular, 'other' a class", () => {
  expect(parse("creatures target player controls")).toMatchObject({ scope: "all", control: "any" });
  expect(parse("a nonland card from target opponent's hand")).toMatchObject({ fromZone: "hand", control: "opp" });
  expect(parse("a nonland card from target opponent's hand")!.scope).toBeUndefined();
  expect(parse("another creature")).toEqual({ control: "any", token: null, type: "creature", other: true });
  expect(parse("up to one other target creature")).toMatchObject({ other: true, scope: "target" });
  expect(parse("two target creatures")).toMatchObject({ scope: "target", type: "creature" });
  expect(parse("any target")).toEqual({ control: "any", token: null, scope: "target" });
});

test("supertypes, combat state, designations and abilities", () => {
  expect(parse("target attacking creature")).toMatchObject({ combat: "attacking" });
  expect(parse("a historic spell")).toMatchObject({ historic: true, type: "spell" });
  expect(parse("a modified creature you control")).toMatchObject({ modified: true });
  expect(parse("creatures of the chosen type")).toMatchObject({ chosenType: true });
  expect(parse("a card named TARDIS")).toMatchObject({ named: "tardis" });
  expect(parse("target activated or triggered ability")).toEqual({ control: "any", token: null, abilityKind: ["activated", "triggered"], scope: "target" });
});

test("a zone: where the subject lives, or where it came from", () => {
  expect(parse("target creature card in your graveyard")).toMatchObject({ zone: "graveyard", control: "you" });
  expect(parse("a creature card from an opponent's graveyard")).toMatchObject({ fromZone: "graveyard", control: "opp" });
});

/** REFUSED: the grammar answers null, and derive keeps `parseSubject`'s answer. Each is a narrowing
 *  the schema cannot hold (dropping it would WIDEN the claim), a reference, or not a filter at all. */
test("refusals", () => {
  for (const p of [
    "target tapped creature", "target nonbasic land", "a multicolored spell",
    // `combat` holds one state; "attacking or blocking" is either.
    "target attacking or blocking creature",
    // A colour that belongs to one alternative, and a zone that belongs to one alternative.
    "a Swamp, Mountain, black permanent, or red permanent",
    "target spell, nonland permanent, or card in a graveyard",
    // References (task 4) and non-filters (tasks 5, 6).
    "this creature", "that card", "Flying", "{C}", "chapter II",
    // Two objects of different kinds.
    "target spell, activated ability, or triggered ability",
  ]) expect(parse(p), p).toBeNull();
});

test("the lexer: one token per word, size, mana symbol and comma; '~' and sentence punctuation fail", () => {
  expect(lex("a 2/2 black Zombie, or {C}")).toEqual(["a", "2/2", "black", "zombie", ",", "or", "{c}"]);
  expect(lex("one or more Goblins and/or Orcs")).toEqual(["one", "or", "more", "goblins", "and/or", "orcs"]);
  expect(lex("~")).toBeNull();
  expect(lex("a creature.")).toBeNull();
});
