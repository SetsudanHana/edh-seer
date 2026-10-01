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
  expect(read("return it to the battlefield tapped under its owner's control.")).toMatchObject([{ verb: "return", toZone: "battlefield" }]);
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

test.each([
  ["draw/search", ["draw", "discard", "mill", "scry", "surveil", "search", "reveal"], 0.945],
  ["damage/life", ["deal-damage", "gain-life", "lose-life", "set-life"], 0.895],
  ["counters", ["add-counter", "remove-counter", "proliferate"], 0.775],
  ["tokens", ["create", "populate", "amass", "investigate", "incubate"], 0.9],
  ["zone", ["destroy", "exile", "sacrifice", "return", "put", "shuffle"], 0.88],
  ["pump/grant", ["modify-pt", "grant-ability"], 0.795],
  ["mana/tap/cant", ["add-mana", "tap", "untap", "cant"], 0.735],
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
