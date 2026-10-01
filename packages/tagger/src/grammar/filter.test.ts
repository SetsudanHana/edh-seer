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
  expect(parse("one or more of your opponents")).toEqual({ control: "opp", token: null, scope: "all" });
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
  // ...and `copyOf` says what it copies: any creature you control, any nontoken creature.
  expect(parse("a token that's a copy of target creature you control")).toEqual({ control: "any", token: true, type: "creature", copyOf: { type: "creature", control: "you" } });
  expect(parse("a token that's a copy of target nontoken creature")).toEqual({ control: "any", token: true, type: "creature", copyOf: { type: "creature", token: false } });
  // A copy of a reference: the token is all the phrase says (the class comes from the referent, task 4).
  expect(parse("a token that's a copy of it")).toEqual({ control: "any", token: true });
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

test("an adjective in only some alternatives is that alternative's own branch", () => {
  expect(parse("target artifact or tapped creature")!.anyOf).toEqual([{ type: "artifact" }, { type: "creature", tapped: true }]);
  // A noun-less alternative takes the head noun after it.
  expect(parse("target tapped or blocking creature")).toMatchObject({ type: "creature", anyOf: [{ tapped: true }, { combat: "blocking" }] });
  expect(parse("target attacking, blocking, or tapped creature")!.anyOf).toEqual([{ combat: "attacking" }, { combat: "blocking" }, { tapped: true }]);
  expect(parse("target artifact, enchantment, or tapped creature an opponent controls")).toMatchObject({ control: "opp", scope: "target" });
  // ...only the head noun: snow creatures or Zombie creatures.
  expect(parse("other snow and Zombie creatures you control")).toMatchObject({ type: "creature", other: true, anyOf: [{ snow: true }, { subtype: "zombie" }] });
  expect(parse("a Swamp, Mountain, black permanent, or red permanent")!.anyOf).toEqual(
    [{ subtype: "swamp" }, { subtype: "mountain" }, { type: "permanent", colors: ["B"] }, { type: "permanent", colors: ["R"] }]);
  // Two states joined by "and" are both: one token, tapped and attacking.
  expect(parse("a tapped and attacking token that's a copy of it")).toEqual({ control: "any", token: true, tapped: true, combat: "attacking" });
  // "attacking, blocking, or tapped" is a list; "nonartifact, nonblack" is still both.
  expect(parse("target nonartifact, nonblack creature")).toMatchObject({ type: "creature", notColors: ["B"] });
  // A negated colour that starts a new noun phrase is that phrase's own: two branches.
  expect(parse("target land or nonblack creature")!.anyOf).toEqual([{ type: "land" }, { type: "creature", notColors: ["B"] }]);
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
  // Not split inside a relative clause: the list is what the spell targets, a player or a creature.
  expect(parse("a spell that targets an opponent or a creature an opponent controls")).toMatchObject({
    type: "spell", targets: { control: "opp", anyOf: [{ player: true }, { type: "creature" }] } });
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

test("statuses, histories, name relations, shares, exclusions and whose ability", () => {
  expect(parse("a face-down creature you control")).toMatchObject({ status: ["face-down"], control: "you" });
  expect(parse("an enchanted creature you control")).toMatchObject({ status: ["enchanted"] });
  // Bare, "enchanted creature" is the object an Aura is attached to: a reference, not a class.
  expect(parse("enchanted creature")).toBeNull();
  expect(parse("target nonattacking creature")).toMatchObject({ notStatus: ["attacking"] });
  expect(parse("target creature that was dealt damage this turn")).toMatchObject({ history: ["dealt-damage"] });
  expect(parse("a spell with the chosen name")).toMatchObject({ nameRelation: "chosen" });
  expect(parse("Other creatures with the same name as this creature are goaded")).toBeNull();
  // The relation the matcher already checks (Folk Hero): `sharesTypeWith`, not a refused `shares`.
  expect(parse("a spell that shares a creature type with this creature")).toMatchObject({ sharesTypeWith: "self" });
  expect(parse("a spell that shares a creature type with this creature")!.shares).toBeUndefined();
  expect(parse("all creatures except for Merfolk, Krakens, Leviathans, Octopuses, and Serpents")!.except).toHaveLength(5);
  expect(parse("a loyalty ability of a Chandra planeswalker")).toMatchObject({ abilityKind: ["loyalty"], abilityOf: { type: "planeswalker", subtype: "chandra" } });
  expect(parse("a creature you control but don't own")).toMatchObject({ control: "you", owner: "opp" });
  expect(parse("a card you own from outside the game")).toMatchObject({ owner: "you", fromZone: "outside" });
});

test("a player beside an object is a branch of its own", () => {
  expect(parse("target player or planeswalker")).toEqual({ control: "any", token: null, scope: "target", anyOf: [{ player: true }, { type: "planeswalker" }] });
  expect(parse("you or a permanent you control")).toMatchObject({ control: "you", anyOf: [{ player: true }, { type: "permanent" }] });
  // "you control" inside an item names no player item.
  expect(parse("Skeletons and Zombies you control; menace")).toMatchObject({ subtype: ["skeleton", "zombie"], control: "you" });
});

test("alternatives with types of their own, and a leading subtype that all of them share", () => {
  expect(parse("a creature card or Garruk planeswalker card")!.anyOf).toEqual([{ type: "creature" }, { type: "planeswalker", subtype: "garruk" }]);
  expect(parse("an Adventure instant or sorcery spell")).toMatchObject({ type: ["instant", "sorcery"], subtype: "adventure" });
  // After a noun, only another noun: "blocking enchanted creature" is a participle with an object, a
  // combat relation to the creature the Aura enchants.
  expect(parse("all non-Wall creatures blocking enchanted creature")).toMatchObject({ notSubtype: ["wall"], combatWith: { role: "blocking", with: "ref" } });
});

test("grant objects: the recipient is the filter", () => {
  expect(parse("target creature, trample")).toEqual({ control: "any", token: null, type: "creature", scope: "target" });
  expect(parse("target creature +2/+0")).toMatchObject({ type: "creature", scope: "target" });
});

test("origins excluded, combat relations, ownership", () => {
  expect(parse("a spell from anywhere other than your hand")).toMatchObject({ type: "spell", notFromZone: "hand" });
  expect(parse("a creature blocking this creature")).toMatchObject({ combatWith: { role: "blocking", with: "self" } });
  expect(parse("target creature without flying that's attacking you")).toMatchObject({ notKeyword: ["flying"], combatWith: { role: "attacking", with: "you" } });
  expect(parse("a spell you don't own")).toMatchObject({ owner: "opp" });
  expect(parse("target permanent you own or control")).toMatchObject({ anyOf: [{ owner: "you" }, { control: "you" }] });
  expect(parse("a permanent other than a basic land")).toMatchObject({ type: "permanent", except: [{ type: "land", basic: true }] });
});

test("a spell or an ability is two branches, and a restriction binds both", () => {
  expect(parse("target spell or ability")).toEqual({ control: "any", token: null, scope: "target",
    anyOf: [{ type: "spell" }, { abilityKind: ["activated", "triggered"] }] });
  expect(parse("target spell or ability that targets only a single permanent or player")).toMatchObject({ restricted: true });
});

test("copy exceptions, conditions on the target, alternatives, destinations", () => {
  expect(parse("a token that's a copy of target creature you control, except it isn't legendary")).toEqual({ control: "any", token: true, type: "creature", legendary: false, copyOf: { type: "creature", control: "you" } });
  expect(parse("target creature if it's white")).toMatchObject({ type: "creature", colors: ["W"] });
  expect(parse("a Desert card from your hand or library")).toMatchObject({ subtype: "desert", anyOf: [{ fromZone: "hand" }, { fromZone: "library" }] });
  expect(parse("spells with flash or flying from the top of your library")).toMatchObject({ anyOf: [{ keyword: ["flash"] }, { keyword: ["flying"] }] });
  expect(parse("target creature into their library")).toEqual({ control: "any", token: null, type: "creature", scope: "target" });
  expect(parse("up to one card of each permanent type from your graveyard")).toMatchObject({ type: "permanent", fromZone: "graveyard" });
  expect(parse("target creature, haste until end of turn")).toMatchObject({ type: "creature", scope: "target" });
  expect(parse("any target that isn't a Dragon")).toMatchObject({ scope: "target", notSubtype: ["dragon"] });
  expect(parse("all creatures that aren't of the chosen type")).toMatchObject({ except: [{ chosenType: true }] });
  expect(parse("a spell with power, toughness, or mana value 4")!.anyOf).toHaveLength(3);
  // A one-value adjective in one alternative only (review): legendary binds to the creature alone.
  expect(parse("target artifact or legendary creature")!.anyOf).toEqual([{ type: "artifact" }, { type: "creature", legendary: true }]);
});

test("players with a history, counted creations, ordinals, tokens named after a card", () => {
  expect(parse("each opponent who lost life this turn")).toMatchObject({ control: "opp", history: ["lost-life"] });
  expect(parse("a number of 1/1 red Warrior creature tokens equal to the number of creatures target player controls")).toMatchObject({ token: true, subtype: "warrior" });
  expect(parse("a second target creature you control")).toMatchObject({ type: "creature", scope: "target", control: "you" });
  expect(parse("a Tarmogoyf token")).toEqual({ control: "any", token: true });
  expect(parse("target land you control as a 4/4 Elemental creature")).toMatchObject({ type: "land", control: "you" });
});

test("lists whose items each carry their own colour, and a post-modifier after the last item", () => {
  expect(parse("a Swamp or black permanent")!.anyOf).toEqual([{ subtype: "swamp" }, { type: "permanent", colors: ["B"] }]);
  expect(parse("Black spells and green spells you cast")).toMatchObject({ control: "you", type: "spell", anyOf: [{ colors: ["B"] }, { colors: ["G"] }] });
  expect(parse("artifact spells and colorless spells from the top of your library")).toMatchObject({ fromZone: "library", control: "you" });
  expect(parse("an exhaust ability")).toEqual({ control: "any", token: null, abilityKind: ["activated"], keyword: ["exhaust"] });
  expect(parse("target nonsnow creature")).toMatchObject({ snow: false });
});

/** REFUSED: the grammar answers null, and derive keeps `parseSubject`'s answer. Each is a narrowing
 *  the schema cannot hold (dropping it would WIDEN the claim), a reference, or not a filter at all. */
test("refusals", () => {
  for (const p of [
    // References (task 4) and non-filters (tasks 5, 6).
    "this creature", "that card", "Flying", "{C}", "chapter II",
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

test("relations to a reference, histories, negations by exclusion, and ownership", () => {
  expect(parse("an Aura attached to this creature")).toMatchObject({ subtype: "aura" });
  expect(parse("other creatures you control that are enchanted by Auras you control")).toMatchObject({ control: "you", status: ["enchanted"], other: true });
  expect(parse("target creature you cast this turn")).toMatchObject({ control: "you", history: ["cast"] });
  // "this turn" after spells you cast is the effect's duration, not a history.
  expect(parse("Artifact spells you cast this turn")).toEqual({ control: "you", token: null, type: "artifact", scope: "all" });
  expect(parse("target spell cast from a graveyard")).toMatchObject({ type: "spell", fromZone: "graveyard" });
  expect(parse("each creature without a +1/+1 counter on it")).toMatchObject({ except: [{ counter: "+1/+1" }] });
  expect(parse("target non-outlaw creature")).toMatchObject({ except: [{ outlaw: true }] });
  expect(parse("each creature that isn't all colors")).toMatchObject({ except: [{ colorCount: "all" }] });
  expect(parse("Other Pegasi, Unicorns, and Horses you control")).toMatchObject({ subtype: ["pegasus", "unicorn", "horse"] });
  expect(parse("two cards your opponents own from exile")).toMatchObject({ owner: "opp", fromZone: "exile" });
  expect(parse("Spells you cast but don't own")).toMatchObject({ control: "you", owner: "opp" });
  expect(parse("creatures the active player controls")).toMatchObject({ control: "any", type: "creature" });
  expect(parse("creatures your team controls")).toMatchObject({ control: "you", type: "creature" });
  expect(parse("a spell you've cast")).toMatchObject({ control: "you", history: ["cast"] });
});

test("conditions on a target, shared stats, counts read past, and bigger numbers", () => {
  expect(parse("target spell if its mana value is X")).toMatchObject({ stats: [{ metric: "mana-value", op: "eq", variable: true }] });
  expect(parse("target spell if it has the same name as that card")).toMatchObject({ nameRelation: "same" });
  expect(parse("target creature if it attacked or blocked this turn")).toMatchObject({ history: ["attacked-or-blocked"] });
  expect(parse("each creature with the same mana value as the sacrificed creature")).toMatchObject({ shares: { what: "mana-value", with: "ref" } });
  expect(parse("target spell with a single target")).toMatchObject({ restricted: true });
  expect(parse("any number of cards that have mana value 9")).toMatchObject({ stats: [{ metric: "mana-value", op: "eq", value: 9 }] });
  expect(parse("target creature with total power and toughness 5 or less")!.stats).toEqual(
    [{ metric: "power", op: "lte", value: 5 }, { metric: "toughness", op: "lte", value: 5 }]);
  // A keyword list then a count: the count's "counters" is no counter kind.
  expect(parse("a creature token with flying, where X is the number of counters on this creature")).toMatchObject({ keyword: ["flying"] });
  expect(parse("creatures you control equal to the number of lands controlled by the player who controls the fewest")).toMatchObject({ control: "you", type: "creature" });
  expect(parse("thirteen creatures of their choice")).toMatchObject({ type: "creature" });
  expect(parse("two cards from the top five of your library")).toMatchObject({ fromZone: "library" });
  expect(parse("an Elf, Warrior, or Tyvar card")).toMatchObject({ subtype: ["elf", "warrior", "tyvar"] });
  expect(parse("a card named Magnifying Glass and/or a card named Thinking Cap")!.anyOf).toEqual([{ named: "magnifying glass" }, { named: "thinking cap" }]);
});

test("conditions on a player or an object's controller (refused by the matcher, never dropped)", () => {
  expect(parse("each opponent who doesn't control an Elf")).toMatchObject({ control: "opp", condition: { kind: "controls", what: { subtype: "elf" }, negated: true } });
  expect(parse("each player who controls the most creatures")!.condition).toEqual({ kind: "controls", what: { type: "creature" }, most: true });
  expect(parse("each opponent who has three or more poison counters")!.condition).toEqual({ kind: "count", what: "poison", op: "gte", value: 3 });
  expect(parse("target opponent who has more life than you do")!.condition).toEqual({ kind: "count", what: "life", op: "gt", vs: "you" });
  expect(parse("each player with exactly 13 life")!.condition).toEqual({ kind: "count", what: "life", op: "eq", value: 13 });
  expect(parse("each opponent who doesn't sacrifice a permanent")!.condition).toEqual({ kind: "did", verb: "sacrifice", negated: true, what: { type: "permanent" } });
  expect(parse("creatures controlled by players who chose war")).toMatchObject({ type: "creature", condition: { kind: "chose", choice: "war", of: "controller" } });
  expect(parse("target creature whose controller controls an Island")).toMatchObject({ condition: { kind: "controls", what: { subtype: "island" }, of: "controller" } });
  expect(parse("each player whose coin comes up tails")!.condition).toEqual({ kind: "coin" });
  expect(parse("each opponent who lost life this turn")).toMatchObject({ history: ["lost-life"] });
});

test("copy exceptions that set characteristics replace what was copied (CR 707.9b)", () => {
  // The exception says what the token IS; `copyOf` still says what it copies -- a non-Frog creature.
  expect(parse("a token that's a copy of target non-Frog creature, except it's a 1/1 green Frog")).toEqual({ control: "any", token: true, type: "creature", subtype: "frog", colors: ["G"],
    stats: [{ metric: "power", op: "eq", value: 1 }, { metric: "toughness", op: "eq", value: 1 }], copyOf: { type: "creature", notSubtype: ["frog"] } });
  expect(parse("a token that's a copy of it, except it's a 4/4 black Zombie")).toMatchObject({ subtype: "zombie", colors: ["B"] });
  expect(parse("a token that's a copy of target creature, except it's a legendary Alien named Prisoner Zero")).toMatchObject({ legendary: true, named: "prisoner zero", subtype: "alien" });
  expect(parse("a token that's a copy of this creature, except it has haste and loses soulbond")).toMatchObject({ keyword: ["haste"], notKeyword: ["soulbond"] });
  expect(parse("a token that's a copy of target creature you control, except it enters with an additional +1/+1 counter on it")).toMatchObject({ counter: "+1/+1" });
  // An exception on a copy of a reference is kept too.
  expect(parse("a token that's a copy of it, except it isn't legendary")).toEqual({ control: "any", token: true, legendary: false });
});

test("named tokens with commas and quoted abilities, keyword costs, histories with a dealer", () => {
  expect(parse("Voja, Friend to Elves, a legendary 3/3 green and white Wolf creature token")).toMatchObject({ token: true, subtype: "wolf", legendary: true });
  expect(parse('Cragflame, a legendary colorless Equipment artifact token with "Equipped creature gets +1/+1 and has vigilance, trample, and haste" and equip {2}')).toMatchObject({ subtype: "equipment", keyword: ["equip"] });
  expect(parse("a 1/1 white Human creature token with ward {2}")).toMatchObject({ keyword: ["ward"] });
  expect(parse("another creature dealt damage this turn by a Spider you controlled")).toMatchObject({ other: true, history: ["dealt-damage-by-ref"] });
  expect(parse("target player dealt damage by this creature this turn")).toMatchObject({ scope: "target", history: ["dealt-damage-by-self"] });
  expect(parse("a creature you control dealing combat damage to a player")).toMatchObject({ control: "you", history: ["dealing-combat-damage-to-player"] });
  expect(parse("target creature that blocked or was blocked by a Zombie this turn")).toMatchObject({ history: ["blocked-or-was-blocked-by-ref"] });
});

test("list items with their own zones, totals, printings, and smaller forms", () => {
  expect(parse("a permanent you control or a card from your hand or graveyard")!.anyOf).toEqual([{ type: "permanent" }, { anyOf: [{ fromZone: "hand" }, { fromZone: "graveyard" }] }]);
  // A zone binds its own noun: the artifact is not in your hand, nor yours.
  expect(parse("an artifact or a card in your hand")!.anyOf).toEqual([{ control: "any", type: "artifact" }, { control: "you", zone: "hand" }]);
  // ...but one noun said twice shares it.
  expect(parse("artifact spells and colorless spells from the top of your library")).toMatchObject({ fromZone: "library" });
  // "all black and all red creature cards": one noun, two colours -- not two items.
  expect(parse("all black and all red creature cards from their graveyard")).toMatchObject({ type: "creature", colors: ["B", "R"], fromZone: "graveyard" });
  // A zone binds the item it follows.
  expect(parse("target spell, nonland permanent, or card in a graveyard")!.anyOf).toHaveLength(3);
  expect(parse("creatures with total power 12 or greater")!.stats).toEqual([{ metric: "power", op: "gte", value: 12, total: true }]);
  expect(parse("each nontoken permanent with a name originally printed in the Antiquities expansion")).toMatchObject({ printedIn: "antiquities", token: false });
  expect(parse("all cards from all opponents' hands and graveyards")).toMatchObject({ control: "opp", anyOf: [{ fromZone: "hand" }, { fromZone: "graveyard" }] });
  expect(parse("a card named Nissa, Genesis Mage from your graveyard")).toMatchObject({ named: "nissa, genesis mage", fromZone: "graveyard" });
  expect(parse("Abilities your opponents activate that target a Merfolk you control")).toMatchObject({ control: "opp", targets: { subtype: "merfolk", control: "you" } });
  expect(parse("one or more of your opponents")).toEqual({ control: "opp", token: null, scope: "all" });
  expect(parse("on target creature you control")).toMatchObject({ control: "you", type: "creature", scope: "target" });
  expect(parse("target spell that wasn't cast from its owner's hand")).toMatchObject({ notFromZone: "hand" });
  expect(parse("a creature paired with it")).toMatchObject({ type: "creature", status: ["paired"] });
  expect(parse("Aura spells with enchant creature")).toMatchObject({ subtype: "aura", keyword: ["enchant"] });
});

test("the last single-card forms: grants with tails, selections, conditions of the action", () => {
  expect(parse("tokens you control, indestructible until your next turn")).toMatchObject({ control: "you", token: true });
  expect(parse("target creature +2/+2 until end of turn if it is a Snake")).toEqual({ control: "any", token: null, type: "creature", scope: "target" });
  expect(parse("target land, 4/4 Elemental creature")).toMatchObject({ type: "land", scope: "target" });
  expect(parse("a Spellgorger Weird token")).toEqual({ control: "any", token: true, subtype: "weird" });
  expect(parse("a tapped and attacking token that's a copy of it")).toMatchObject({ tapped: true, combat: "attacking" });
  // Two adjectives before the first "or": the first binds the whole list.
  expect(parse("a goaded attacking or blocking creature")).toMatchObject({ status: ["goaded"], anyOf: [{ combat: "attacking" }, { combat: "blocking" }] });
  expect(parse("target creature you control other than enchanted creature")).toMatchObject({ control: "you", otherThanRef: true });
  expect(parse("a spell other than your first spell each turn")).toMatchObject({ history: ["not-first-spell-this-turn"] });
  expect(parse("cards in your hand except X cards you choose")).toEqual({ control: "you", token: null, zone: "hand" });
  expect(parse("each permanent with the same name as another permanent, except for basic lands")).toMatchObject({ nameRelation: "same", except: [{ type: "land", basic: true }] });
  expect(parse("all commanders you own from the command zone and from your graveyard")).toMatchObject({ owner: "you", anyOf: [{ fromZone: "command" }, { fromZone: "graveyard" }] });
  // The kicked bound, the looser, is the union.
  expect(parse("target spell with mana value 2 or less, or mana value 4 or less if this spell was kicked")!.stats).toEqual([{ metric: "mana-value", op: "lte", value: 4 }]);
  expect(parse("target creature if no other creature has greater power")!.stats).toEqual([{ metric: "power", op: "gte", variable: true }]);
  expect(parse("a spell that shares a color or mana value with the exiled card")!.anyOf).toEqual([{ shares: { what: "color", with: "ref" } }, { shares: { what: "mana-value", with: "ref" } }]);
  expect(parse("target Spirit, creature with disturb, or enchantment")!.anyOf).toEqual([{ subtype: "spirit" }, { type: "creature", keyword: ["disturb"] }, { type: "enchantment" }]);
  expect(parse("up to one target creature or its controller")!.anyOf).toEqual([{ type: "creature", scope: "target" }, { player: true }]);
  expect(parse("you and target opponent")!.anyOf).toEqual([{ player: true, control: "you" }, { player: true, control: "opp" }]);
  expect(parse("all creatures except for Mageta")).toMatchObject({ except: [{ named: "mageta" }] });
  expect(parse("Spells you cast that target enchanted player")).toMatchObject({ control: "you", targets: { player: true, status: ["enchanted"] } });
  // A comma list whose first item has a leading adjective keeps it for every item.
  expect(parse("target attacking Cleric, Rogue, Warrior, or Wizard; protection from creatures until end of turn")).toMatchObject({ combat: "attacking", subtype: ["cleric", "rogue", "warrior", "wizard"] });
});

test("the card itself is an item only after another: 'this creature or another Ally' stays derive's twin (#295)", () => {
  expect(parse("two lands and this artifact")!.anyOf).toEqual([{ type: "land", scope: "all" }, { type: "artifact", self: true }]);
  expect(parse("this creature or another Ally you control")).toBeNull();
  expect(parse("this creature and another target creature")).toBeNull();
});

test("the census tail, each shape read from its card's own text", () => {
  // Admiral Beckett Brass, Steel Hellkite: a player's history, and by what.
  expect(parse("target nonland permanent controlled by a player who was dealt combat damage by three or more Pirates this turn")!.condition)
    .toEqual({ kind: "history", event: "dealt-combat-damage", by: { subtype: "pirate" }, of: "controller" });
  expect(parse("each nonland permanent with mana value X whose controller was dealt combat damage by this creature this turn")!.condition)
    .toEqual({ kind: "history", event: "dealt-combat-damage", by: "self", of: "controller" });
  // Grim Reminder, Creeping Dread, Grudge Keeper, Oath of Mages.
  expect(parse("each opponent who cast a spell this turn with the same name as that card")!.condition).toEqual({ kind: "did", verb: "cast", what: { type: "spell", nameRelation: "same" } });
  expect(parse("each opponent who voted for a choice you didn't vote for")!.condition).toEqual({ kind: "chose", choice: "a choice you didn't vote for" });
  expect(parse("target player who has more life than the first player and is their opponent")).toMatchObject({ control: "opp", condition: { kind: "count", what: "life", op: "gt", vs: "ref" } });
  // Expropriate, Stalking Leonin.
  expect(parse("a permanent owned by the money voter")!.condition).toEqual({ kind: "chose", choice: "money", of: "owner" });
  expect(parse("target creature that's attacking you if it's controlled by the chosen player")).toMatchObject({ combatWith: { role: "attacking", with: "you" }, condition: { kind: "chosen", of: "controller" } });
  // Gilt-Leaf Winnower: power and toughness unequal, either way round.
  expect(parse("target non-Elf creature whose power and toughness aren't equal")!.anyOf).toEqual([{ stats: [{ metric: "power", op: "lt", vs: "toughness" }] }, { stats: [{ metric: "power", op: "gt", vs: "toughness" }] }]);
  // Rivals' Duel: no shared creature type with the other target.
  expect(parse("two target creatures that share no creature types")!.shares).toEqual({ what: "creature-type", with: "ref", negated: true });
  // Marvin, Bladegraft Aspirant: whose abilities, and what they target.
  expect(parse("all activated abilities of creatures you control that don't have the same name as this creature")!.abilityOf).toEqual({ control: "you", type: "creature", notNamed: "~" });
  expect(parse("Activated abilities of Equipment you control that target this creature")).toMatchObject({ abilityOf: { subtype: "equipment" }, targets: { self: true } });
  // Nacatl War-Pride, Daretti: copies' states and class.
  expect(parse("tokens that are copies of this creature and that are tapped and attacking")).toMatchObject({ tapped: true, combat: "attacking" });
  expect(parse("tokens that are copies of target artifact card in a graveyard or artifact on the battlefield")).toMatchObject({ token: true, type: "artifact" });
  // Tale's End, Repeated Reverberation, Ultimate Nullification.
  expect(parse("target activated ability, triggered ability, or legendary spell")!.anyOf).toEqual([{ abilityKind: ["activated"] }, { abilityKind: ["triggered"] }, { type: "spell", legendary: true }]);
  expect(parse("an instant spell, a sorcery spell, or a loyalty ability activation")!.anyOf).toEqual([{ type: "instant" }, { type: "sorcery" }, { abilityKind: ["loyalty"] }]);
  expect(parse("all creatures and graveyards")!.anyOf).toEqual([{ type: "creature", scope: "all" }, { zone: "graveyard" }]);
  // Trinisphere: its cost, not its mana value -- variable, the matcher abstains.
  expect(parse("each spell that would cost less than three mana to cast")!.stats).toEqual([{ metric: "mana-value", op: "lt", variable: true }]);
  // Season of the Witch: the exception is a class of its own.
  expect(parse("all untapped creatures that didn't attack this turn, except for creatures that couldn't attack")).toMatchObject({ tapped: false, history: ["not-attacked"], except: [{ type: "creature", history: ["could-not-attack"] }] });
  // Master of the Hunt (CR 702.22b).
  expect(parse("a 1/1 green Wolf creature token named Wolves of the Hunt with bands with other creatures named Wolves of the Hunt")).toMatchObject({ keyword: ["bands with other"] });
});

test("the last fourteen: relations one card states, things not on the battlefield, earlier objects", () => {
  expect(parse("target spell if it would destroy a land you control")!.relation).toEqual({ kind: "would-destroy", what: { type: "land", control: "you" } });
  expect(parse("any number of Aura cards that could enchant it")!.relation).toEqual({ kind: "could-enchant", with: "ref" });
  expect(parse("target creature that has an activated ability with {T} in its cost")!.relation).toEqual({ kind: "has-ability", abilityKind: "activated", tapCost: true });
  expect(parse("target land that is snow or could produce {C}")!.anyOf).toEqual([{ snow: true }, { relation: { kind: "could-produce", mana: ["C"] } }]);
  expect(parse("a card with two or more card types")!.relation).toEqual({ kind: "card-type-count", op: "gte", value: 2 });
  expect(parse("each opponent and each battle they protect")!.anyOf).toEqual([{ control: "opp", player: true }, { control: "any", type: "battle", relation: { kind: "protected-by", control: "opp" } }]);
  expect(parse("target artifact spell you control that isn't the target of an ability from another creature named ~")!.relation).toMatchObject({ kind: "targeted-by", negated: true });
  // "not on the battlefield" binds the alternative it follows; a shared colour prefix binds them all.
  expect(parse("a black or red permanent, spell, or card not on the battlefield")).toEqual({ control: "any", token: null, colors: ["B", "R"], anyOf: [{ type: "permanent" }, { type: "spell" }, { notZone: "battlefield" }] });
  expect(parse("a nontoken creature an opponent owns or a creature card not on the battlefield")!.anyOf).toEqual([{ token: false, owner: "opp" }, { token: null, notZone: "battlefield" }]);
  // An object the sentence named earlier.
  expect(parse("target creature card and the sacrificed card")!.anyOf).toEqual([{ type: "creature", scope: "target" }, { ref: "sentence" }]);
  // A relative clause that ends at "this turn", then the next alternative (Cut Short).
  expect(parse("target planeswalker that was activated this turn or tapped creature")!.anyOf).toEqual([{ type: "planeswalker", history: ["activated"] }, { type: "creature", tapped: true }]);
  expect(parse("one or more cards from graveyards and/or the battlefield")!.anyOf).toEqual([{ fromZone: "graveyard" }, { fromZone: "battlefield" }]);
});

