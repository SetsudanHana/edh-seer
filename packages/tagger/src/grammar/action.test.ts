import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, test } from "vitest";
import { alignVerbs, parseActions } from "./action.js";

// Every effect below is printed text from the action census (`packages/tagger/actions.jsonl.gz`).
const read = (effect: string, cost?: string) => parseActions(effect, "spell", cost);

test("draw, mill, scry, surveil: the amount as the store spells it, the object a card", () => {
  expect(read("Draw two cards.")).toMatchObject([{ verb: "draw", amount: "2", text: "two cards" }]);
  expect(read("Target player mills thirteen cards.")).toMatchObject([{ verb: "mill", amount: "13", actor: { control: "any", scope: "target" } }]);
  expect(read("Scry 2.")).toMatchObject([{ verb: "scry", amount: "2" }]);
  expect(read("Draw a card for each creature you control.")).toMatchObject([{ verb: "draw", amount: "for each creature you control" }]);
  // "where X is ..." is the counted thing as the amount, the store's form and what scaling reads.
  expect(read("Draw X cards, where X is that creature's power.")).toMatchObject([{ verb: "draw", amount: "that creature's power" }]);
  expect(read("Target opponent sacrifices a creature or planeswalker, discards a card, and loses 3 life.")).toMatchObject([
    { verb: "sacrifice", actor: { control: "opp" } }, { verb: "discard", actor: { control: "opp" } }, { verb: "lose-life", text: "target opponent" },
  ]);
});

test("phrases split on the printed joints; an actor carries to the phrases after it", () => {
  expect(read("Draw a card, then discard a card.").map((r) => r.verb)).toEqual(["draw", "discard"]);
  expect(read("Target player draws two cards and loses 2 life.")).toMatchObject([
    { verb: "draw", actor: { scope: "target" } }, { verb: "lose-life", text: "target player", actor: { scope: "target" } },
  ]);
  expect(read("Target opponent draws a card. You draw two cards.")).toMatchObject([
    { verb: "draw", actor: { control: "opp" } }, { verb: "draw", actor: { control: "you" } },
  ]);
  // "you and X each": one action per player, no actor text (the store writes the pair as one or two).
  expect(read("You and target opponent each draw three cards.")).toMatchObject([
    { verb: "draw", amount: "3", actor: { control: "any", scope: "each" } }, { verb: "draw", amount: "3", actor: { control: "any", scope: "each" } },
  ]);
  expect(read("you and those players each draw a card, then discard a card at random.").map((r) => [r.verb, r.actor?.text]))
    .toEqual([["draw", undefined], ["discard", undefined], ["draw", undefined], ["discard", undefined]]);
});

test("conditions are KEPT on the action (owner, 2026-10-01); 'you may' is optional, and so is its 'if you do'", () => {
  expect(read("you may pay {2}. If you do, draw a card.")).toMatchObject([{ verb: "draw", condition: "if you do", optional: true }]);
  expect(read("Draw a card at the beginning of the next turn's upkeep.")).toMatchObject([{ verb: "draw", condition: "at the beginning of the next turn's upkeep" }]);
  expect(read("you may discard a card. If you do, draw a card.")).toMatchObject([{ verb: "discard", optional: true }, { verb: "draw", optional: true }]);
});

test("discard and search: a whole hand, a class, one search per zone named", () => {
  expect(read("Each player discards their hand, then draws seven cards.")).toMatchObject([{ verb: "discard", amount: "all", actor: { scope: "each" } }, { verb: "draw", amount: "7" }]);
  expect(read("Target player discards a card at random.")).toMatchObject([{ verb: "discard", amount: "1" }]);
  expect(read("you may search your library for a basic land card, put it onto the battlefield tapped, then shuffle.")[0])
    .toMatchObject({ verb: "search", fromZone: "library", object: { type: "land", basic: true }, text: "a basic land card", optional: true });
  expect(read("Search target player's graveyard, hand, and library for any number of cards with that name and exile them.").filter((r) => r.verb === "search").map((r) => r.fromZone))
    .toEqual(["graveyard", "hand", "library"]);
});

test("damage and life: the recipient is the object, the dealer is not the actor, one action per recipient", () => {
  expect(read("~ deals 3 damage to any target.")).toMatchObject([{ verb: "deal-damage", amount: "3", text: "any target", object: { scope: "target" } }]);
  expect(read("This creature deals 2 damage to any target and 3 damage to you.")).toMatchObject([
    { verb: "deal-damage", amount: "2", text: "any target" }, { verb: "deal-damage", amount: "3", text: "you" },
  ]);
  expect(read("Target creature you control deals damage equal to its power to target creature an opponent controls."))
    .toMatchObject([{ verb: "deal-damage", amount: "its power", object: { type: "creature", control: "opp" } }]);
  expect(read("~ deals 2 damage divided as you choose among one or two targets.")).toMatchObject([{ verb: "deal-damage", amount: "2", object: { scope: "target" } }]);
  expect(read("you may have it deal 1 damage to any target.")).toMatchObject([{ verb: "deal-damage", optional: true }]);
  // A life change's object is the player, as the store writes it.
  expect(read("each opponent loses 1 life and you gain 1 life.")).toMatchObject([
    { verb: "lose-life", amount: "1", text: "each opponent" }, { verb: "gain-life", amount: "1", text: "you" },
  ]);
  expect(read("You gain 2 life for each creature you control.")).toMatchObject([{ verb: "gain-life", amount: "2 for each creature you control" }]);
  expect(read("As an additional cost to cast this spell, pay X life.")).toMatchObject([{ verb: "lose-life", amount: "X" }]);
  expect(read("Your life total becomes 10.")).toMatchObject([{ verb: "set-life", amount: "10" }]);
});

test("counters: the kind is `counter`, the recipient the object (#731)", () => {
  expect(read("put a +1/+1 counter on target creature you control.")).toMatchObject([
    { verb: "add-counter", counter: "+1/+1", amount: "1", text: "target creature you control", object: { type: "creature", control: "you", scope: "target" } },
  ]);
  expect(read("This creature enters with X +1/+1 counters on it.")).toMatchObject([{ verb: "add-counter", counter: "+1/+1", amount: "X", object: { self: true } }]);
  expect(read("Put two +1/+1 counters and a flying counter on ~.").map((r) => [r.counter, r.amount])).toEqual([["+1/+1", "2"], ["flying", "1"]]);
  expect(read("Distribute three +1/+1 counters among one, two, or three target creatures you control.")).toMatchObject([{ counter: "+1/+1", amount: "3", object: { type: "creature" } }]);
  expect(read("Create a Saproling.", "{1}, Remove a +1/+1 counter from a creature you control")).toMatchObject([
    { verb: "remove-counter", counter: "+1/+1", object: { type: "creature", control: "you" } },
  ]);
  expect(read("you get {E}{E} .")).toMatchObject([{ verb: "add-counter", counter: "energy", amount: "2" }]);
  expect(read("Proliferate.")).toMatchObject([{ verb: "proliferate" }]);
});

test("tokens: the printed phrase, its count, a quoted ability kept whole", () => {
  expect(read('create a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."')).toMatchObject([
    { verb: "create", amount: "1", text: 'a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."', object: { token: true, subtype: ["eldrazi", "spawn"] } },
  ]);
  expect(read("create two Treasure tokens.")).toMatchObject([{ verb: "create", amount: "2", object: { subtype: "treasure" } }]);
  expect(read("create a Clue token, a Food token, and a Treasure token.").map((r) => r.object?.subtype)).toEqual(["clue", "food", "treasure"]);
  expect(read("you may sacrifice another creature you control. If you do, create a number of Treasure tokens equal to that creature's power."))
    .toMatchObject([{ verb: "sacrifice", optional: true }, { verb: "create", amount: "that creature's power", text: "Treasure tokens" }]);
  expect(read("Create an X/X colorless Shapeshifter creature token with changeling and deathtouch, where X is the number of land cards in your graveyard.")[0]?.text)
    .toMatch(/, where X is the number of land cards in your graveyard$/);
  // A copy of a back-reference keeps the stored object.
  expect(read("For each token you control, create a token that's a copy of that permanent.")[0]?.text).toBeUndefined();
  expect(read("amass Orcs 2.")).toMatchObject([{ verb: "amass", amount: "2", text: "Orcs" }]);
  expect(read("Investigate twice.")).toMatchObject([{ verb: "investigate", amount: "2" }]);
  // Quoted text is the granted ability's, never this clause's actions.
  expect(read('Creatures you control have "Whenever this creature attacks, draw a card."')).toEqual([]);
});

test("zone moves: the zones, the count kept in the text, a back-reference kept as stored", () => {
  expect(read("Return target creature card from your graveyard to your hand.")).toMatchObject([
    { verb: "return", text: "target creature card from your graveyard", fromZone: "graveyard", toZone: "hand", object: { type: "creature" } },
  ]);
  // A permanent returned with no "from" leaves the battlefield; a pronoun keeps the stored object.
  expect(read("Return target nonland permanent to its owner's hand.")).toMatchObject([{ fromZone: "battlefield", toZone: "hand" }]);
  expect(read("return it to the battlefield tapped under its owner's control.")).toMatchObject([{ verb: "return", toZone: "battlefield" }, { verb: "tap" }]);
  expect(read("return it to the battlefield tapped under its owner's control.")[0]?.text).toBeUndefined();
  // No amount: a zone move's count is in its text, as the store writes it.
  expect(read("each opponent sacrifices two creatures of their choice.")).toMatchObject([{ verb: "sacrifice", text: "two creatures of their choice", actor: { control: "opp" } }]);
  expect(read("each opponent sacrifices two creatures of their choice.")[0]?.amount).toBeUndefined();
  expect(read("Destroy up to one target artifact or enchantment.")).toMatchObject([{ verb: "destroy", optional: true }]);
  expect(read("Exile the top card of your library.")).toMatchObject([{ verb: "exile", fromZone: "library", toZone: "exile" }]);
  // Two destinations are two moves; counters it arrives with are counters.
  expect(read("Put one of them into your hand and the rest on the bottom of your library in any order.").map((r) => r.toZone)).toEqual(["hand", "library"]);
  expect(read("Exile ~ with three time counters on it.")).toMatchObject([{ verb: "exile" }, { verb: "add-counter", counter: "time", amount: "3" }]);
  // A destination is the zone named, not the last word: "instead of into that player's graveyard".
  expect(read("put it on the bottom of its owner's library instead of into that player's graveyard.")).toEqual([]);
  // "until they exile a nonland card" says which card, not how long.
  expect(read("that player exiles cards from the top of their library until they exile a nonland card.")).toEqual([]);
  // "from their graveyard": whose is a back-reference, so the stored object stays.
  expect(read("Put a land card from their graveyard onto the battlefield tapped under your control.")[0]?.text).toBeUndefined();
  expect(read("Then shuffle.")).toMatchObject([{ verb: "shuffle", text: "your library" }]);
});

test("pumps and grants: the pump's object is who gets it, each grant's text the ability", () => {
  expect(read("Target creature gets +3/+3 and gains trample until end of turn.")).toMatchObject([
    { verb: "modify-pt", text: "target creature", amount: "+3/+3" }, { verb: "grant-ability", text: "trample", object: { type: "creature", scope: "target" } },
  ]);
  expect(read("Target creature gains deathtouch and indestructible until end of turn.").map((r) => r.text)).toEqual(["deathtouch", "indestructible"]);
  expect(read("Equipped creature gets +1/+1 for each creature you control.")).toMatchObject([{ amount: "+1/+1 for each creature you control" }]);
  expect(read("Enchanted creature gets -X/-0, where X is the number of cards in your graveyard.")).toMatchObject([{ amount: "-X/-0, where X is the number of cards in your graveyard" }]);
  // A condition is kept; a back-reference keeps the stored object.
  expect(read("This creature gets +1/+1 as long as you control a Swamp.")).toMatchObject([{ verb: "modify-pt", condition: "as long as you control a Swamp" }]);
  expect(read("it gets +2/+0 until end of turn.")[0]?.text).toBeUndefined();
  // The next phrase's "gains" is the same creature's.
  expect(read("Target creature gets +2/+2 until end of turn. It gains flying until end of turn.").map((r) => r.verb)).toEqual(["modify-pt", "grant-ability"]);
  // Only an ability is granted: "you gain 3 life", "gain control of" are not grants.
  expect(read("You gain 3 life.").map((r) => r.verb)).toEqual(["gain-life"]);
});

test("mana, tapping and restrictions: the mana as printed, the restricted thing as the text", () => {
  expect(read("Add {R} or {G}.")).toMatchObject([{ verb: "add-mana", text: "{R} or {G}" }]);
  expect(read("Add {G} for each creature you control.")).toMatchObject([{ verb: "add-mana", text: "{G}", amount: "for each creature you control" }]);
  expect(read("Add an amount of {G} equal to this creature's power.")).toMatchObject([{ text: "{G}", amount: "this creature's power" }]);
  expect(read("This land enters tapped unless you control two or fewer other lands.")).toMatchObject([{ verb: "tap", object: { self: true }, condition: "unless you control two or fewer other lands" }]);
  expect(read("Tap up to two target creatures.")).toMatchObject([{ verb: "tap", text: "up to two target creatures", optional: true }]);
  expect(read("This creature can't block.")).toMatchObject([{ verb: "cant", text: "block" }]);
  expect(read("This creature attacks each combat if able.")).toMatchObject([{ verb: "cant", text: "not attack each combat if able" }]);
  expect(read("This creature can block only creatures with flying.")).toMatchObject([{ verb: "cant", text: "block creatures without flying" }]);
  // A restriction's "unless" stays in it: the tax derive reads.
  expect(read("Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.")[0]?.text)
    .toBe("attack you unless their controller pays {2} for each creature they control that's attacking you");
});

test("the long tail: counterspells, control, fights, keyword actions", () => {
  expect(read("Counter target spell unless its controller pays {2}.")).toMatchObject([{ verb: "counter-spell", text: "target spell", condition: "unless its controller pays {2}" }]);
  expect(read("Gain control of target creature until end of turn.")).toMatchObject([{ verb: "gain-control", text: "target creature" }]);
  // The store's pair, or the other creature alone when the fighter is a back-reference.
  expect(read("Target creature you control fights target creature you don't control.")[0]?.text).toBe("target creature you control and target creature you don't control");
  expect(read("you may have it fight target creature you don't control.")).toMatchObject([{ verb: "fight", text: "target creature you don't control", optional: true }]);
  expect(read("it connives.")).toMatchObject([{ verb: "connive" }]);
  expect(read("it connives.")[0]?.text).toBeUndefined();
  expect(read("copy it for each time you've cast your commander from the command zone this game.")).toMatchObject([{ verb: "copy", amount: "for each time you've cast your commander from the command zone this game" }]);
  expect(read("bolster 2.")).toMatchObject([{ verb: "bolster", amount: "2" }]);
  expect(read("you become the monarch.")).toMatchObject([{ verb: "monarch" }]);
  expect(read("venture into the dungeon.")).toMatchObject([{ verb: "venture-into-the-dungeon" }]);
});

test("coverage push: predicate lists, repeated grants, keyword lines, restrictions, carried taps", () => {
  expect(read("Equipped creature gets +2/+2, has trample and haste, and is a Samurai in addition to its other types.").map((r) => r.verb))
    .toEqual(["modify-pt", "grant-ability", "grant-ability", "grant-ability"]);
  expect(read("Enchanted creature has base power and toughness 9/9 and has flying.")).toMatchObject([{ verb: "modify-pt", amount: "9/9" }, { verb: "grant-ability", text: "flying" }]);
  expect(read("this creature gets -1/-1 and gains your choice of flying, vigilance, deathtouch, or haste.").filter((r) => r.verb === "grant-ability")).toHaveLength(4);
  expect(read("As long as a creature card with flying is in a graveyard, this creature has flying. The same is true for fear and trample.").map((r) => r.text))
    .toEqual(["flying", "fear", "trample"]);
  expect(read("Flying, vigilance, haste").map((r) => r.text)).toEqual(["flying", "vigilance", "haste"]);
  expect(read("This creature can't block and can't be blocked.").map((r) => r.text)).toEqual(["block", "be blocked"]);
  expect(read("Permanents your opponents control lose hexproof and indestructible until end of turn.").map((r) => [r.verb, r.text])).toEqual([["cant", "hexproof"], ["cant", "indestructible"]]);
  expect(read("Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.").map((r) => r.verb)).toEqual(["search", "put", "tap", "shuffle"]);
  expect(read("you may tap or untap target permanent.").map((r) => r.verb)).toEqual(["tap", "untap"]);
  expect(read("Put a +1/+1 counter on target creature and two +1/+1 counters on another target creature.").map((r) => r.amount)).toEqual(["1", "2"]);
});

test("coverage push 2: object lists, recipient lists, control magic, clones, casting and costs", () => {
  expect(read("Destroy target artifact, target creature, target enchantment, and target land.").map((r) => r.text))
    .toEqual(["target artifact", "target creature", "target enchantment", "target land"]);
  expect(read("Exile all artifacts, creatures, and lands.")).toHaveLength(1);
  expect(read("Return up to one target artifact card and up to one target sorcery card from your graveyard to your hand.").map((r) => [r.fromZone, r.toZone]))
    .toEqual([["graveyard", "hand"], ["graveyard", "hand"]]);
  expect(read("~ deals 3 damage to each creature and each player.").map((r) => r.text)).toEqual(["each creature", "each player"]);
  expect(read("You control enchanted creature.")).toMatchObject([{ verb: "gain-control", text: "enchanted creature" }]);
  expect(read("You may have this creature enter as a copy of any creature on the battlefield.")).toMatchObject([{ verb: "copy", optional: true }]);
  expect(read("You may cast creature spells from the top of your library.")).toMatchObject([{ verb: "cast", fromZone: "library" }]);
  expect(read("You may play an additional land on each of your turns.")).toMatchObject([{ verb: "play", text: "an additional land" }]);
  expect(read("Instant and sorcery spells you cast cost {1} less to cast.")).toMatchObject([{ verb: "cost-modify", amount: "-1" }]);
  expect(read("Prevent all combat damage that would be dealt this turn.")).toMatchObject([{ verb: "prevent" }]);
  // A narrowing the filter can drop is not read: the stored action stands.
  expect(read("You may cast spells that have a cycling ability from your graveyard.")).toEqual([]);
});

test("coverage push 3: game and keyword actions read by verb, the stored object kept", () => {
  for (const [text, verb] of [["roll a d20.", "roll-dice"], ["flip a coin.", "flip-coin"], ["Take an extra turn after this one.", "extra-turn"],
    ["you win the game.", "win-game"], ["that player loses the game.", "lose-game"], ["After this phase, there is an additional combat phase.", "extra-combat"],
    ["This creature phases out.", "phase-out"], ["clash with an opponent.", "clash"], ["manifest the top card of your library.", "manifest"],
    ["Switch target creature's power and toughness until end of turn.", "exchange"], ["earthbend 2.", "earthbend"]] as const) {
    expect(read(text).map((r) => r.verb)).toEqual([verb]);
  }
  expect(read("You may choose not to untap this creature during your untap step.")).toMatchObject([{ verb: "untap", optional: true }]);
  expect(read("Target creature's owner puts it on their choice of the top or bottom of their library.")).toMatchObject([{ verb: "put", toZone: "library" }]);
});

test("fragments 1: a back-referenced controller and a set made 'this way' are read, the stored object kept", () => {
  const destroy = read("destroy target artifact or enchantment that player controls.");
  expect(destroy).toMatchObject([{ verb: "destroy", object: { type: ["artifact", "enchantment"], ref: "sentence" } }]);
  expect(destroy[0]?.text).toBeUndefined();
  expect(read("goad each creature that player controls.")).toMatchObject([{ verb: "goad", object: { ref: "sentence" } }]);
  expect(read("Target opponent exiles a creature or planeswalker they control with the greatest mana value among creatures and planeswalkers they control.")[0])
    .toMatchObject({ verb: "exile", object: { type: ["creature", "planeswalker"], ref: "sentence" } });
  expect(read("Put all Elf cards revealed this way into your hand and the rest on the bottom of your library in any order.")[0])
    .toMatchObject({ verb: "put", object: { subtype: "elf", ref: "sentence" }, toZone: "hand" });
  // "this turn" is a history, not a back-reference.
  expect(read("Destroy each creature that attacked this turn.")[0]?.object?.ref).toBeUndefined();
});

test("fragments 2: a leading duration, set P/T on becoming, losing abilities, casting restrictions, entering with counters", () => {
  expect(read("Until end of turn, target creature becomes a white Rabbit with base power and toughness 0/1.").map((r) => [r.verb, r.amount]))
    .toEqual([["animate", undefined], ["modify-pt", "0/1"]]);
  expect(read("Until end of turn, target creature loses all abilities and becomes a blue Frog with base power and toughness 1/1.")[0])
    .toMatchObject({ verb: "cant", text: "have abilities" });
  expect(read("Cast this spell only during the declare attackers step and only if you've been attacked this step.").map((r) => r.text))
    .toEqual(["cast this spell only during the declare attackers step", "cast this spell only if you've been attacked this step"]);
  expect(read("You may cast the exiled card without paying its mana cost.")).toMatchObject([{ verb: "cast", object: { ref: "sentence" } }]);
  // A class that enters with counters names its recipient; the card itself keeps the stored object.
  expect(read("Each other non-Human creature you control enters with an additional +1/+1 counter on it.")[0])
    .toMatchObject({ verb: "add-counter", counter: "+1/+1", amount: "1", text: "each other non-Human creature you control" });
  expect(read("it enters with two +1/+1 counters on it and with trample.").map((r) => r.verb)).toEqual(["add-counter", "grant-ability"]);
  expect(read("this creature enters with your choice of a deathtouch counter or a lifelink counter on it.").map((r) => r.counter)).toEqual(["deathtouch", "lifelink"]);
});

test("a cost's actions come first, the cost's own words read the same way", () => {
  expect(read("Create a Treasure token.", "{U/R}{U/R}, Discard this card")).toMatchObject([{ verb: "discard", object: { self: true } }, { verb: "create" }]);
  // A cost the segmenter left in the text is still a cost; ability words and table rows are labels.
  expect(read("Remove a time counter from this card.", "Sacrifice an artifact, creature, or land")[0]).toMatchObject({ verb: "sacrifice", text: "an artifact, creature, or land" });
  expect(read("Crescent Fang — Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.")[0]?.verb).toBe("search");
});

test("readings align to stored actions by verb, in order", () => {
  expect(alignVerbs(["sacrifice", "draw"], ["draw"])).toEqual([[1, 0]]);
  expect(alignVerbs(["search", "search", "search", "exile", "shuffle"], ["search", "search", "search"])).toEqual([[0, 0], [1, 1], [2, 2]]);
});

// Fragments 3 (#896): a copy's exceptions, alternative costs and strive, mana by shape, prevention
// shields, "a number of" counters, and a "then double" phrase of its own.
test("fragments 3: copies with exceptions, alternative costs, mana, shields, counted counters", () => {
  const verbs = (t: string) => parseActions(t, "triggered").map((a) => a.verb);
  expect(verbs("You may have this creature enter as a copy of a creature an opponent controls, except it's a Faerie Shapeshifter in addition to its other types and it has flying."))
    .toEqual(["copy", "grant-ability", "grant-ability"]);
  const become = parseActions("you may have this creature become a copy of another target creature until end of turn, except it has haste.", "triggered");
  expect(become[0]).toMatchObject({ verb: "copy", text: "another target creature", optional: true });
  expect(become[1]).toMatchObject({ verb: "grant-ability", text: "haste" });
  // An exception this grammar cannot read leaves the whole phrase unread.
  expect(parseActions("You may have this creature enter as a copy of any creature on the battlefield, except its name is Bob.", "static")).toEqual([]);
  expect(parseActions("Create a token that's a copy of target creature you control, except it isn't legendary.", "spell")[0])
    .toMatchObject({ verb: "create", text: "a token that's a copy of target creature you control, except it isn't legendary" });
  expect(parseActions("If an opponent cast a blue spell this turn, you may pay {R} rather than pay this spell's mana cost.", "static")[0])
    .toMatchObject({ verb: "cost-modify", optional: true, condition: "if an opponent cast a blue spell this turn" });
  expect(verbs("This spell costs {1}{G} more to cast for each target beyond the first.")).toEqual(["cost-modify"]);
  for (const t of ["add one mana of any type that land produced.", "Add two mana of different colors.", "add {B} or one mana of the chosen color.",
    "its controller adds an additional one mana of any color.", "Add X mana in any combination of {B} and/or {R}."]) expect(verbs(t)).toEqual(["add-mana"]);
  expect(parseActions("The next time a black source of your choice would deal damage to you this turn, prevent that damage.", "spell")[0])
    .toMatchObject({ verb: "prevent", text: "the next time a black source of your choice would deal damage to you this turn" });
  expect(parseActions("put a number of +1/+1 counters equal to its power on up to one target creature.", "triggered")[0])
    .toMatchObject({ verb: "add-counter", counter: "+1/+1", amount: "its power", text: "up to one target creature" });
  expect(verbs("put a +1/+1 counter on target creature, then double the number of +1/+1 counters on it.")).toEqual(["add-counter", "double"]);
});

test.each([
  ["draw/search", ["draw", "discard", "mill", "scry", "surveil", "search", "reveal"], 0.947],
  ["damage/life", ["deal-damage", "gain-life", "lose-life", "set-life"], 0.919],
  ["counters", ["add-counter", "remove-counter", "proliferate"], 0.847],
  ["tokens", ["create", "populate", "amass", "investigate", "incubate"], 0.914],
  ["zone", ["destroy", "exile", "sacrifice", "return", "put", "shuffle"], 0.904],
  ["pump/grant", ["modify-pt", "grant-ability"], 0.861],
  ["mana/tap/cant", ["add-mana", "tap", "untap", "cant"], 0.884],
  ["tail", ["counter-spell", "gain-control", "fight", "goad", "regenerate", "transform", "attach", "copy", "detain", "suspect", "bolster", "adapt",
    "monstrosity", "support", "discover", "collect-evidence", "venture-into-the-dungeon", "manifest-dread", "learn", "monarch", "initiative", "ring-tempts",
    "explore", "connive", "endure"], 0.801],
  ["cast/play/prevent/cost/double/animate", ["cast", "play", "prevent", "cost-modify", "double", "animate"], 0.707],
])("over the census: deterministic, and %s coverage not below its floor", (_name, verbs, floor) => {
  const FAMILY = new Set(verbs as string[]);
  const rows = gunzipSync(readFileSync(new URL("../../actions.jsonl.gz", import.meta.url))).toString("utf8").trim().split("\n")
    .map((l) => JSON.parse(l) as { effect: string; type: string | null; cost?: string; actions: { verb: string }[]; cards: number });
  let total = 0, got = 0;
  for (const r of rows) {
    const a = parseActions(r.effect, r.type, r.cost);
    expect(JSON.stringify(parseActions(r.effect, r.type, r.cost))).toBe(JSON.stringify(a));
    const fam = (v: string) => FAMILY.has(v);
    const si = r.actions.flatMap((x, i) => (fam(x.verb) ? [i] : [])), ri = a.flatMap((x, j) => (fam(x.verb) ? [j] : []));
    const hit = new Set(alignVerbs(si.map((i) => r.actions[i]!.verb), ri.map((j) => a[j]!.verb)).map(([i]) => si[i]));
    r.actions.forEach((x, i) => { if (FAMILY.has(x.verb)) { total += r.cards; if (hit.has(i)) got += r.cards; } });
  }
  // A RATCHET per family, raised as coverage grows. 2.0% of stored draw/search actions print no such
  // verb in their clause text at all (an empty text, or an action filed under the wrong clause).
  expect(got / total).toBeGreaterThanOrEqual(floor as number);
}, 120000);
