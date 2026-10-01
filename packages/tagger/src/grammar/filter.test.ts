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

test("CR 303.4a: an Aura's enchant line is the class it can enchant", () => {
  expect(parse("Enchant creature you control")).toEqual({ control: "you", token: null, type: "creature" });
  expect(parse("Enchant creature card in a graveyard")).toMatchObject({ type: "creature", zone: "graveyard" });
});

test("a copy token has the original's copiable values (CR 707.2), not its controller, target or token-ness", () => {
  expect(parse("a token that's a copy of target creature you control")).toEqual({ control: "any", token: true, type: "creature" });
  expect(parse("a token that's a copy of target nontoken creature")).toEqual({ control: "any", token: true, type: "creature" });
  expect(parse("a token that's a copy of it")).toBeNull();
});

test("relative clauses the schema holds, and 'other than this'", () => {
  expect(parse("a spell that has convoke")).toMatchObject({ type: "spell", keyword: ["convoke"] });
  expect(parse("a 1/1 white Cat Soldier creature token with vigilance that's attacking")).toMatchObject({ combat: "attacking", token: true });
  expect(parse("a spell that's white, blue, black, or red")).toMatchObject({ colors: ["W", "U", "B", "R"] });
  expect(parse("a creature other than this creature")).toEqual({ control: "any", token: null, type: "creature", other: true });
});

test("origins: the top of a library, a single graveyard, all graveyards; the battlefield is no origin", () => {
  expect(parse("lands from the top of your library")).toMatchObject({ type: "land", fromZone: "library", control: "you" });
  expect(parse("up to two target cards from a single graveyard")).toMatchObject({ fromZone: "graveyard", scope: "target" });
  expect(parse("all creature cards from all graveyards")).toMatchObject({ type: "creature", fromZone: "graveyard" });
  expect(parse("an artifact from the battlefield")).toEqual({ control: "any", token: null, type: "artifact" });
});

test("fields the schema gained for the grammar: tapped, negated colours, colour count, nonbasic, nonlegendary, snow, any counter, in-combat", () => {
  expect(parse("target tapped creature")).toMatchObject({ tapped: true });
  expect(parse("an untapped creature you control")).toMatchObject({ tapped: false, control: "you" });
  expect(parse("target nonblack creature")).toMatchObject({ notColors: ["B"], type: "creature" });
  expect(parse("target nonwhite, nonblack creature")).toMatchObject({ notColors: ["W", "B"] });
  expect(parse("a multicolored spell")).toMatchObject({ colorCount: "multi" });
  expect(parse("target monocolored creature")).toMatchObject({ colorCount: "mono" });
  expect(parse("target nonbasic land")).toMatchObject({ basic: false, type: "land" });
  expect(parse("target nonlegendary creature")).toMatchObject({ legendary: false });
  expect(parse("a snow land")).toMatchObject({ snow: true });
  expect(parse("a creature you control with a counter on it")).toMatchObject({ hasCounter: true });
  expect(parse("target attacking or blocking creature")).toMatchObject({ combat: "in-combat" });
});

test("CR 115.1: what a spell targets is its own field (owner 2026-10-01, the heroic condition)", () => {
  expect(parse("a spell that targets this creature")).toEqual({ control: "any", token: null, type: "spell", targets: { self: true, type: "creature" } });
  expect(parse("a spell that targets ~")).toMatchObject({ type: "spell", targets: { self: true } });
  expect(parse("a spell that targets a creature you control")).toMatchObject({ control: "any", targets: { control: "you", type: "creature" } });
  // After a second noun phrase the clause binds only that one: two phrases, their union.
  expect(parse("an Equipment spell or a spell that targets a creature you control")).toEqual({
    control: "any", token: null, type: "spell",
    anyOf: [{ subtype: "equipment" }, { targets: { control: "you", token: null, type: "creature" } }] });
});

test("a one-value adjective in only some alternatives is refused", () => {
  for (const p of ["target artifact or tapped creature", "target tapped or blocking creature", "target land or nonblack creature"]) expect(parse(p), p).toBeNull();
  expect(parse("target multicolored creature or multicolored enchantment")).toMatchObject({ colorCount: "multi" });
});

test("stat comparisons: a bare value, a run, the subject's own stat, and a variable rhs", () => {
  expect(parse("a creature card with mana value X or less")!.stats).toEqual([{ metric: "mana-value", op: "lte", variable: true }]);
  expect(parse("a creature you control with power equal to its toughness")!.stats).toEqual([{ metric: "power", op: "eq", vs: "toughness" }]);
  expect(parse("a creature spell with mana value 4, 5, or 6")!.stats).toEqual([
    { metric: "mana-value", op: "gte", value: 4 }, { metric: "mana-value", op: "lte", value: 6 }]);
  expect(parse("a creature an opponent controls with power or toughness 1 or less")!.anyOf).toEqual([
    { stats: [{ metric: "power", op: "lte", value: 1 }] }, { stats: [{ metric: "toughness", op: "lte", value: 1 }] }]);
  // The count's zone is the count's: the creature is not in a hand.
  expect(parse("each creature with power greater than the number of cards in your hand")).not.toHaveProperty("zone");
  // A variable rhs is an amount, never a clause.
  expect(parse("Creatures with power less than this creature's power can't block creatures you control")).toBeNull();
});

test("lists of whole noun phrases are their union", () => {
  expect(parse("target creature you control and target creature you don't control")).toEqual({
    control: "any", token: null, type: "creature", scope: "target", anyOf: [{ control: "you" }, { control: "opp" }] });
  expect(parse("another creature you control or a land you control")).toMatchObject({ control: "you", anyOf: [{ type: "creature", other: true }, { type: "land" }] });
  expect(parse("each creature and each planeswalker")).toMatchObject({ type: ["creature", "planeswalker"] });
  // Not inside a relative clause: the spell targets a player or a creature, which the schema cannot say.
  expect(parse("a spell that targets an opponent or a creature an opponent controls")).toBeNull();
  // A list, not a named token.
  expect(parse("a Blood token, a Clue token, or a Food token")).toMatchObject({ subtype: ["blood", "clue", "food"] });
});

test("token names, Roles, keyword lists, long card names, irregular plurals", () => {
  expect(parse("Marit Lage, a legendary 20/20 black Avatar creature token with flying and indestructible")).toMatchObject({
    token: true, subtype: "avatar", legendary: true, keyword: ["flying", "indestructible"] });
  expect(parse("a Young Hero Role token")).toEqual({ control: "any", token: true, subtype: "role" });
  expect(parse("a 2/2 black Knight creature token with flanking, protection from white, and haste")).toMatchObject({
    colors: ["B"], keyword: ["flanking", "haste", "protection"] });
  expect(parse("a card named Ajani, Valiant Protector")).toMatchObject({ named: "ajani, valiant protector" });
  expect(parse("Other Rabbits, Bats, Birds, and Mice you control")).toMatchObject({ subtype: ["rabbit", "bat", "bird", "mouse"] });
  expect(parse("creatures of the creature type of your choice")).toMatchObject({ chosenType: true, control: "any" });
});

test("more origins and quantifiers", () => {
  expect(parse("a creature card from the top five cards of your library")).toMatchObject({ fromZone: "library", control: "you" });
  expect(parse("each of up to three targets")).toMatchObject({ scope: "target" });
  expect(parse("an additional land")).toEqual({ control: "any", token: null, type: "land" });
});

/** REFUSED: the grammar answers null, and derive keeps `parseSubject`'s answer. Each is a narrowing
 *  the schema cannot hold (dropping it would WIDEN the claim), a reference, or not a filter at all. */
test("refusals", () => {
  for (const p of [
    // A colour that belongs to one alternative, and a zone that belongs to one alternative.
    "a Swamp, Mountain, black permanent, or red permanent",
    "target spell, nonland permanent, or card in a graveyard",
    // References (task 4) and non-filters (tasks 5, 6).
    "this creature", "that card", "Flying", "{C}", "chapter II",
    // Two objects of different kinds.
    "target spell, activated ability, or triggered ability",
  ]) expect(parse(p), p).toBeNull();
});

test("the lexer: one token per word, size, mana symbol, comma and '~'; sentence punctuation fails", () => {
  expect(lex("a 2/2 black Zombie, or {C}")).toEqual(["a", "2/2", "black", "zombie", ",", "or", "{c}"]);
  expect(lex("one or more Goblins and/or Orcs")).toEqual(["one", "or", "more", "goblins", "and/or", "orcs"]);
  // "~" lexes so a clause can name the card itself ("a spell that targets ~"); alone it parses as nothing.
  expect(lex("~")).toEqual(["~"]);
  expect(parse("~")).toBeNull();
  expect(lex("a creature.")).toBeNull();
});
