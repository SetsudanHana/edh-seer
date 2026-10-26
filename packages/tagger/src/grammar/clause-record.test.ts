import { expect, test } from "vitest";
import { deriveCardTags } from "../derive/derive.js";
import { deriveInputOf } from "../derive-input.js";
import { grammarClauseRecords, phaseControl, triggerSubjectText } from "./clause-record.js";
import { effectText } from "./preamble.js";
import { selfAsTilde, selfPronouns } from "./self-as-tilde.js";

// #896 task 7: clause records from printed text alone.
test("a card the grammar reads completely gets one record per clause, in the store's shape", () => {
  const farseek = grammarClauseRecords({ name: "Farseek", typeLine: "Sorcery", oracleText: "Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle." });
  expect(farseek.complete).toBe(true);
  const [rec] = farseek.records;
  expect(rec).toMatchObject({ id: 1, abilityType: "spell" });
  // The back-reference keeps its printed words, and comes from the library the search named.
  expect(rec!.actions!.find((a) => a.verb === "put")).toMatchObject({ object: "it", fromZone: "library", toZone: "battlefield" });
});

test("a clause the grammar cannot read blocks the card, and says which", () => {
  const g = grammarClauseRecords({ name: "X", typeLine: "Sorcery", oracleText: "Redistribute any number of players' life totals." });
  expect(g.complete).toBe(false);
  expect(g.blocker).toMatchObject({ clause: 1, kind: "action" });
});

test("a trigger's subject is what the event happens to, and an actor trigger's object", () => {
  expect(triggerSubjectText("Whenever this creature or another creature dies")).toBe("this creature or another creature");
  expect(triggerSubjectText("Whenever you discard a card")).toBe("a card");
});

test("a self trigger's first 'it' is the card itself, and a player verb names its player", () => {
  const junk = grammarClauseRecords({ name: "Wall of Junk", typeLine: "Artifact Creature — Wall", oracleText: "When this creature blocks, return it to its owner's hand at end of combat." });
  expect(junk.records[0]!.actions![0]).toMatchObject({ verb: "return", object: "this creature" });
  const barrier = grammarClauseRecords({ name: "Barrier of Bones", typeLine: "Creature — Skeleton Wall", oracleText: "When this creature enters, surveil 1." });
  expect(barrier.records[0]!.actions![0]).toMatchObject({ verb: "surveil", amount: "1" });
});

test("a phase trigger's subject is whose phase", () => {
  expect(triggerSubjectText("At the beginning of your upkeep")).toBe("you");
  expect(triggerSubjectText("At the beginning of each upkeep")).toBe("each player");
});

test("a proliferate chooses any permanent; support names other creatures; a token list is one create per kind", () => {
  const tide = grammarClauseRecords({ name: "Inexorable Tide", typeLine: "Enchantment", oracleText: "Whenever you cast a spell, proliferate." });
  expect(tide.records[0]!.actions![0]).toMatchObject({ verb: "proliferate", object: "any" });
  const patron = grammarClauseRecords({ name: "Generous Patron", typeLine: "Creature — Elf Advisor", oracleText: "When this creature enters, support 2." });
  expect(patron.records[0]!.actions![0]).toMatchObject({ verb: "support", object: "other target creatures", amount: "2" });
  const cotton = grammarClauseRecords({ name: "Farmer Cotton", typeLine: "Legendary Creature — Halfling Peasant", oracleText: "When this creature enters, create X 1/1 white Halfling creature tokens and X Food tokens." });
  expect(cotton.records[0]!.actions!.map((a) => a.object)).toEqual(["X 1/1 white Halfling creature tokens", "X Food tokens"]);
});

test("spells given affinity are a cost reduction, the store's form", () => {
  const pearl = grammarClauseRecords({ name: "Pearl-Ear, Imperial Advisor", typeLine: "Legendary Creature — Fox Advisor", oracleText: "Enchantment spells you cast have affinity for Auras." });
  expect(pearl.records[0]!.actions![0]).toMatchObject({ verb: "cost-modify" });
});

test("a phase trigger's control is whose turns it watches", () => {
  expect(phaseControl("At the beginning of your upkeep")).toBe("you");
  expect(phaseControl("At the beginning of combat on your turn")).toBe("you");
  expect(phaseControl("At the beginning of each opponent's upkeep")).toBe("opp");
  expect(phaseControl("At the beginning of each combat")).toBe("any");
  expect(phaseControl("At the beginning of each player's draw step")).toBe("any");
});

test("labelling round 1: payments, antecedents, amounts and delayed triggers as the store writes them", () => {
  const one = (name: string, typeLine: string, oracleText: string) => grammarClauseRecords({ name, typeLine, oracleText }).records;
  // A "can't ... unless ... pays" keeps its payment apart.
  expect(one("Propaganda", "Enchantment", "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.")[0]!.actions![0])
    .toMatchObject({ verb: "cant", object: "attack you", unless: { cost: "{2} for each creature they control that's attacking you", payer: "controller" } });
  // "untap it" after a target is that target; "its controller investigates" is that player.
  expect(one("High Stride", "Instant", "Target creature gets +1/+3 and gains reach until end of turn. Untap it.")[0]!.actions!.at(-1)).toMatchObject({ verb: "untap", object: "target creature" });
  expect(one("Fateful Absence", "Instant", "Destroy target creature or planeswalker. Its controller investigates.")[0]!.actions![1]).toMatchObject({ verb: "investigate", object: "its controller" });
  // A stated count is the amount.
  expect(one("Explore", "Sorcery", "You may play an additional land this turn.")[0]!.actions![0]).toMatchObject({ verb: "play", amount: "1" });
  // A spell shuffling itself leaves the stack; a card revealed from hand moves from the hand.
  expect(one("Beacon of Immortality", "Instant", "Double target player's life total. Shuffle Beacon of Immortality into its owner's library.")[0]!.actions![1]).toMatchObject({ verb: "shuffle", fromZone: "stack" });
  expect(one("Retraced Image", "Sorcery", "Reveal a card in your hand, then put that card onto the battlefield if it has the same name as a permanent.")[0]!.actions![0]).toMatchObject({ verb: "put", fromZone: "hand" });
  // A whole-clause delayed trigger is the clause's trigger; a mid-sentence one is not.
  expect(one("Vizkopa Guildmage", "Creature — Human Wizard", "{1}{W}{B}: Whenever you gain life this turn, each opponent loses that much life.")[0]!.trigger).toMatchObject({ event: "life-gained", control: "you" });
  expect(one("Ghostway", "Instant", "Exile each creature you control. Return those cards to the battlefield under their owner's control at the beginning of the next end step.")[0]!.trigger).toBeUndefined();
  // "You and Humans you control have hexproof": the class's grant.
  expect(one("Sigarda, Heron's Grace", "Legendary Creature — Angel", "You and Humans you control have hexproof.")[0]!.actions![0]).toMatchObject({ verb: "grant-ability", object: "hexproof" });
});

test("labelling round 2: pronouns name their antecedent, and a move says where it goes and how", () => {
  const one = (name: string, typeLine: string, oracleText: string) => grammarClauseRecords({ name, typeLine, oracleText }).records;
  // An Aura's trigger on its host: "it" is the enchanted creature.
  expect(one("Bestial Fury", "Enchantment — Aura", "Whenever enchanted creature becomes blocked, it gets +4/+0 and gains trample until end of turn.")[0]!.actions![0])
    .toMatchObject({ verb: "modify-pt", object: "enchanted creature" });
  // "put that card on top" after a search comes from the library; a cast "without paying its mana cost" is still "that card".
  expect(one("Cruel Tutor", "Sorcery", "Search your library for a card, then shuffle and put that card on top. You lose 2 life.")[0]!.actions!.find((a) => a.verb === "put"))
    .toMatchObject({ fromZone: "library" });
  expect(one("Sunforger", "Artifact — Equipment", "{R}{W}, Unattach this Equipment: Search your library for a red or white instant card with mana value 4 or less and cast that card without paying its mana cost. Then shuffle.")[0]!.actions!.find((a) => a.verb === "cast"))
    .toMatchObject({ object: "that card" });
  // "from all hands and graveyards": one exile from each; "return her ... transformed" transforms too.
  expect(one("Worldfire", "Sorcery", "Exile all permanents. Exile all cards from all hands and graveyards. Each player's life total becomes 1.")[0]!.actions!.filter((a) => a.verb === "exile").map((a) => a.fromZone))
    .toEqual(["battlefield", "hand", "graveyard"]);
  expect(one("Liliana, Heretical Healer", "Legendary Creature — Human Cleric", "Whenever another nontoken creature you control dies, exile Liliana, Heretical Healer, then return her to the battlefield transformed under her owner's control.")[0]!.actions!.map((a) => a.verb))
    .toContain("transform");
});

test("labelling round 3: zones and players the sentence implies", () => {
  const one = (name: string, typeLine: string, oracleText: string) => grammarClauseRecords({ name, typeLine, oracleText }).records;
  // A dies trigger's "that card", a countered spell's exile.
  expect(one("Demonic Vigor", "Enchantment — Aura", "When enchanted creature dies, return that card to its owner's hand.")[0]!.actions![0]).toMatchObject({ verb: "return", fromZone: "graveyard" });
  expect(one("Void Shatter", "Instant", "Counter target spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.")[0]!.actions![1]).toMatchObject({ verb: "exile", object: "it", fromZone: "stack" });
  // "exile up to two target cards from a single graveyard"; "up to" is not a destination.
  expect(one("Shred Memory", "Instant", "Exile up to four target cards from a single graveyard.")[0]!.actions![0]).toMatchObject({ verb: "exile", object: "up to four target cards from a single graveyard", fromZone: "graveyard" });
  // A whose-life-total names the player; an actor's "their graveyard" names the actor.
  expect(one("Magister Sphinx", "Artifact Creature — Sphinx", "When this creature enters, target player's life total becomes 10.")[0]!.actions![0]).toMatchObject({ verb: "set-life", object: "target player" });
  expect(one("Scrabbling Claws", "Artifact", "{T}: Target player exiles a card from their graveyard.")[0]!.actions![0]).toMatchObject({ object: "a card from target player's graveyard" });
  // A phase trigger's "it" with the clause's own "this creature" is the card.
  expect(one("Cactuar", "Creature — Plant", "At the beginning of your end step, if this creature didn't enter the battlefield this turn, return it to its owner's hand.")[0]!.actions![0])
    .toMatchObject({ verb: "return", object: "this creature", fromZone: "battlefield" });
  // A defined X is no paid X.
  expect(one("Heronblade Elite", "Creature — Human Warrior", "{T}: Add X mana of any one color, where X is this creature's power.")[0]!.actions![0]).not.toHaveProperty("amount");
});

// #1210 task 1: a punctuated ability word, and a game-start delayed effect.
const readCard = (name: string, typeLine: string, oracleText: string, keywords: string[] = []) => grammarClauseRecords({ name, typeLine, oracleText, keywords });

test("an ability word with ? ! or - in it labels the clause and is neither trigger subject nor object (#1210)", () => {
  const sq = readCard("The Unbeatable Squirrel Girl", "Legendary Creature — Squirrel Human Hero",
    "Do You Like Squirrels? — Whenever The Unbeatable Squirrel Girl enters or attacks, create a 1/1 green Squirrel creature token.\nI LOVE Squirrels! — {1}{G}{G}{G}: Create X 1/1 green Squirrel creature tokens, where X is the number of Squirrels you control.", ["I LOVE Squirrels!"]);
  expect(sq.blocker).toBeUndefined();
  expect(sq.complete).toBe(true);
  expect(sq.records.filter((r) => r.trigger).map((r) => r.trigger!.event).sort()).toEqual(["attacks", "enters"]);
  expect(sq.records[0]!.actions![0]).toMatchObject({ verb: "create" });
  const tally = readCard("Tallyman of Nurgle", "Creature — Astartes Warrior",
    "Lifelink\nThe Seven-fold Chant — At the beginning of your end step, if a creature died this turn, you draw a card and you lose 1 life. If seven or more creatures died this turn, instead you draw seven cards and you lose 7 life.", ["Lifelink", "The Seven-fold Chant"]);
  expect(tally.blocker).toBeUndefined();
  expect(tally.complete).toBe(true);
});

test("a game-start reveal records only the delayed effect's actions, with no trigger (#1210)", () => {
  const dross = readCard("Chancellor of the Dross", "Creature — Phyrexian Vampire",
    "You may reveal this card from your opening hand. If you do, at the beginning of the first upkeep, each opponent loses 3 life, then you gain life equal to the life lost this way.\nFlying, lifelink", ["Flying", "Lifelink"]);
  expect(dross.blocker).toBeUndefined();
  expect(dross.records[0]).toMatchObject({ abilityType: "static" });
  expect(dross.records[0]!.trigger).toBeUndefined();
  expect(dross.records[0]!.actions!.map((a) => a.verb)).toEqual(["lose-life", "gain-life"]);
  expect(dross.records[0]!.actions![0]).toMatchObject({ object: "each opponent", amount: "3" });
  const cases: [string, string, string, string[]][] = [
    ["Chancellor of the Annex", "Creature — Phyrexian Angel", "You may reveal this card from your opening hand. If you do, when each opponent casts their first spell of the game, counter that spell unless that player pays {1}.\nFlying\nWhenever an opponent casts a spell, counter it unless that player pays {1}.", ["counter-spell"]],
    ["Chancellor of the Forge", "Creature — Phyrexian Giant", "You may reveal this card from your opening hand. If you do, at the beginning of the first upkeep, create a 1/1 red Phyrexian Goblin creature token with haste.\nWhen this creature enters, create X 1/1 red Phyrexian Goblin creature tokens with haste, where X is the number of creatures you control.", ["create"]],
    ["Chancellor of the Spires", "Creature — Phyrexian Sphinx", "You may reveal this card from your opening hand. If you do, at the beginning of the first upkeep, each opponent mills seven cards.\nFlying\nWhen this creature enters, you may cast target instant or sorcery card from an opponent's graveyard without paying its mana cost.", ["mill"]],
    ["Chancellor of the Tangle", "Creature — Phyrexian Treefolk", "You may reveal this card from your opening hand. If you do, at the beginning of your first main phase of the game, add {G}.\nReach, vigilance", ["add-mana"]],
    ["Sphinx of Foresight", "Creature — Sphinx", "You may reveal this card from your opening hand. If you do, scry 3 at the beginning of your first upkeep.\nFlying\nAt the beginning of your upkeep, scry 1.", ["scry"]],
  ];
  for (const [name, type, text, verbs] of cases) {
    const g = readCard(name, type, text);
    expect(g.blocker, name).toBeUndefined();
    expect(g.complete, name).toBe(true);
    expect(g.records[0]!.trigger, name).toBeUndefined();
    expect(g.records[0]!.actions!.map((a) => a.verb), name).toEqual(verbs);
  }
  expect(readCard("Chancellor of the Annex", "Creature", cases[0]![2]).records[0]!.actions![0]).toMatchObject({ verb: "counter-spell", unless: { payer: "opponent" } });
  // ...the same action the card's own second clause reads.
  const annex = readCard("Chancellor of the Annex", "Creature", cases[0]![2]).records;
  expect(annex[0]!.actions![0]!.unless).toEqual(annex.at(-1)!.actions![0]!.unless);
});

test("a labelled keyword line stays a keyword line, and a labelled cost the segmenter missed refuses (#1210 review)", () => {
  const arms = readCard("Paladin's Arms", "Artifact — Equipment", "Lightbringer and Hero's Shield — Equip {4}");
  expect(arms.complete).toBe(true);
  expect(arms.records).toMatchObject([{ id: 1, abilityType: "none", actions: [{ verb: "none" }] }]);
  const blitz = readCard("Blitzball Stadium", "Land", "Go for the Goal! — {3}, {T}: Until end of turn, target creature gains \"Whenever this creature deals combat damage to a player, draw a card.\" and it can't be blocked this turn.");
  expect(blitz.complete).toBe(false);
  expect(blitz.blocker).toMatchObject({ clause: 1, kind: "action" });
  const strax = readCard("Strax", "Creature — Sontaran", "Grenades! — {2}, {T}, Sacrifice an artifact: This creature deals 2 damage to any target.");
  expect(strax.complete).toBe(false);
});

test("a mana cost behind a label the segmenter missed makes the clause activated, and derive's input carries the cost (#1210)", async () => {
  const text = "Do You Like Squirrels? — Whenever The Unbeatable Squirrel Girl enters or attacks, create a 1/1 green Squirrel creature token.\nI LOVE Squirrels! — {1}{G}{G}{G}: Create X 1/1 green Squirrel creature tokens, where X is the number of Squirrels you control.";
  const g = readCard("The Unbeatable Squirrel Girl", "Legendary Creature — Squirrel Human Hero", text, ["I LOVE Squirrels!"]);
  expect(g.records.find((r) => r.id === 2)).toMatchObject({ abilityType: "activated" });
  const { clauseCosts, clauseTexts } = await import("../derive-input.js");
  const doc = { oracleText: text, keywords: ["I LOVE Squirrels!"], typeLine: "Legendary Creature — Squirrel Human Hero" };
  const activated = new Set(g.records.filter((r) => r.abilityType === "activated").map((r) => r.id));
  expect(clauseCosts(doc)[2]).toBeUndefined();
  expect(clauseCosts(doc, activated)[2]).toBe("{1}{G}{G}{G}");
  expect(clauseTexts(doc, activated)[2]).toMatch(/^Create X 1\/1 green Squirrel/);
});

// #1210 task 2: six more shapes.
test("energy payment, replacement lead-in, duration lead, look-at-top, 'who doesn't', roll-a-die (#1210)", () => {
  const turret = readCard("Consulate Turret", "Artifact", "{T}: You get {E} (an energy counter).\n{T}, Pay {E}{E}{E}: This artifact deals 2 damage to target player or planeswalker.");
  expect(turret.blocker).toBeUndefined();
  // The segmenter classes "{T}, Pay {E}{E}{E}:" static; the payment is a cost of an activated clause.
  expect(turret.records[1]).toMatchObject({ abilityType: "activated" });
  expect(turret.records[1]!.actions!.map((a) => a.verb)).toEqual(["remove-counter", "deal-damage"]);
  expect(turret.records[1]!.actions![0]).toMatchObject({ object: "energy counter", amount: "3" });

  const warden = readCard("Crowd-Control Warden", "Creature — Human Soldier", "As this creature enters or is turned face up, put X +1/+1 counters on it, where X is the number of other creatures you control.\nDisguise {3}{G/W}{G/W} (You may cast this card face down for {3} as a 2/2 creature with ward {2}. Turn it face up any time for its disguise cost.)", ["Disguise"]);
  expect(warden.blocker).toBeUndefined();
  expect(warden.records[0]).toMatchObject({ abilityType: "static" });
  expect(warden.records[0]!.actions![0]).toMatchObject({ verb: "add-counter", object: "+1/+1", amount: "the number of other creatures you control" });

  const familiar = readCard("Ertai's Familiar", "Creature — Illusion", "Phasing (This phases in or out before you untap during each of your untap steps. While it's phased out, it's treated as though it doesn't exist.)\nWhen this creature phases out or leaves the battlefield, mill three cards.\n{U}: Until your next upkeep, this creature can't phase out.", ["Phasing"]);
  expect(familiar.blocker).toBeUndefined();
  expect(familiar.records.at(-1)!.actions![0]).toMatchObject({ verb: "cant", object: "phase out" });
  expect(familiar.records[1]!.trigger).toMatchObject({ event: "phases-out", subject: "this creature" });

  const viv = readCard("Vivien's Invocation", "Sorcery", "Look at the top seven cards of your library. You may put a creature card from among them onto the battlefield. Put the rest on the bottom of your library in a random order. When a creature is put onto the battlefield this way, it deals damage equal to its power to target creature an opponent controls.");
  // The reflexive "When a creature is put onto the battlefield this way" has no reading (only "when you do"
  // does): the card stays incomplete, but the first clause reads.
  expect(viv.blocker).toMatchObject({ clause: 2, kind: "trigger" });
  expect(viv.records[0]!.actions![0]).toMatchObject({ verb: "put", object: "a creature card from the top seven cards of your library", fromZone: "library", toZone: "battlefield", optional: true });
  expect(viv.records[0]!.actions![1]).toMatchObject({ verb: "put", object: "the rest of the top seven cards of your library", fromZone: "library", toZone: "library" });

  const wernog = readCard("Wernog, Rider's Chaplain", "Legendary Creature — Human Cleric", "When Wernog, Rider's Chaplain enters or leaves the battlefield, each opponent may investigate. Each opponent who doesn't loses 1 life. You investigate X times, where X is one plus the number of opponents who investigated this way.");
  expect(wernog.blocker).toBeUndefined();
  const w = wernog.records.flatMap((r) => r.actions!);
  expect(w.find((a) => a.verb === "lose-life")).toMatchObject({ object: "each opponent who doesn't investigate", amount: "1" });
  // The comma in the card's name hid the segmenter's two-event flag: "enters or leaves" is two records.
  expect(wernog.records.map((r) => r.trigger?.event)).toEqual(["enters", "leaves"]);
  expect(w.find((a) => a.verb === "investigate")).toBeDefined();

  const xeno = readCard("Xenosquirrels", "Creature — Squirrel", "This creature enters with two +1/+1 counters on it.\nAfter you roll a die, you may remove a +1/+1 counter from this creature. If you do, increase or decrease the result by 1.");
  expect(xeno.blocker).toBeUndefined();
  const x = xeno.records[1]!;
  expect(x).toMatchObject({ abilityType: "static" });
  expect(x.trigger).toMatchObject({ event: "roll-dice" });
  expect(x.actions![0]).toMatchObject({ verb: "remove-counter", optional: true });
});

// #1210 task 2 review: what the six readings must not break on cards that were already right.
test("cards of a looked-at library are yours, and the exiled card is not what a cost tapped (#1210)", async () => {
  const bargain = readCard("Rakshasa's Bargain", "Instant", "Look at the top four cards of your library. Put two of them into your hand and the rest into your graveyard.");
  expect(bargain.records[0]!.actions).toMatchObject([
    { verb: "put", object: "two of the top four cards of your library", fromZone: "library", toZone: "hand" },
    { verb: "put", object: "the rest of the top four cards of your library", fromZone: "library", toZone: "graveyard" },
  ]);
  const nightwatch = readCard("Gurmag Nightwatch", "Creature — Zombie", "When this creature enters, look at the top three cards of your library. You may put one of those cards back on top of your library. Put the rest into your graveyard.");
  expect(nightwatch.records[0]!.actions![0]).toMatchObject({ object: "one of the top three cards of your library", toZone: "library" });
  const durnan = readCard("Durnan of the Yawning Portal", "Legendary Creature — Human Warrior", "Whenever Durnan of the Yawning Portal attacks, exile a creature card from the top four cards of your library. For as long as that card remains exiled, you may cast it. That spell has undaunted.");
  expect(durnan.records[0]!.actions!.find((a) => a.verb === "cast")).toMatchObject({ object: "the exiled creature card", fromZone: "exile" });
  // "it becomes plotted" is a status, never an animation.
  const luck = readCard("Make Your Own Luck", "Sorcery", "Look at the top three cards of your library. You may exile a nonland card from among them. If you do, it becomes plotted. Put the rest into your hand.");
  expect(luck.records[0]!.actions!.map((a) => a.verb)).toEqual(["exile", "put"]);
  expect(luck.records[0]!.actions![0]).toMatchObject({ fromZone: "library", object: "a nonland card from the top three cards of your library" });
  // The punished opponents keep the store's wording, which derive reads into a negated did.
  const fandaniel = readCard("Fandaniel, Telophoroi Ascian", "Legendary Creature — Human", "At the beginning of your end step, each opponent may sacrifice a nontoken creature of their choice. Each opponent who doesn't loses 2 life for each instant and sorcery card in your graveyard.");
  expect(fandaniel.records[0]!.actions![1]).toMatchObject({ verb: "lose-life", object: "each opponent who doesn't sacrifice" });
  const nissa = readCard("Nissa, Genesis Mage", "Legendary Planeswalker — Nissa", "+2: Untap up to two target creatures and up to two target lands.");
  expect(nissa.records[0]!.actions!.map((a) => a.object)).toEqual(["up to two target creatures", "up to two target lands"]);
  const ashiok = readCard("Ashiok", "Legendary Planeswalker — Ashiok", "−7: Target player exiles the top X cards of their library, where X is the total mana value of cards you own in exile.");
  expect(ashiok.records[0]!.actions![0]).toMatchObject({ verb: "exile", amount: "the total mana value of cards you own in exile" });
  // An energy payment the segmenter left static is the cost of an activated clause.
  const surveillance = readCard("Consulate Surveillance", "Enchantment", "When this enchantment enters, you get {E}{E}{E}{E} (four energy counters).\nPay {E}{E}: Prevent all damage that would be dealt to you this turn by a source of your choice.");
  expect(surveillance.records.at(-1)).toMatchObject({ abilityType: "activated" });
  // Dermotaxi: the copy is of the exiled card, never of the creatures tapped to pay.
  const { grammarClauseRecords: records } = await import("./clause-record.js");
  const { deriveInputOf } = await import("../derive-input.js");
  const { deriveCardTags } = await import("../derive/derive.js");
  const card = { name: "Dermotaxi", typeLine: "Artifact — Vehicle", oracleText: "Imprint — As this Vehicle enters, exile a creature card from a graveyard.\nTap two untapped creatures you control: Until end of turn, this Vehicle becomes a copy of the exiled card, except it's a Vehicle artifact in addition to its other types.", keywords: [] };
  const g = records(card);
  const tags = deriveCardTags(deriveInputOf(card as never, "x", card.name, g.records, undefined, g.readings));
  const copy = tags.abilities.find((a) => a.effect.kind === "clone");
  expect(copy?.emits?.[0]?.subject).toMatchObject({ control: "any" });
  expect(copy?.emits?.[0]?.subject.type).toBeUndefined();
});

test("a 'who doesn't' with no declined choice before it refuses; an exile that moved the cards leaves the rest in exile (#1210 review)", () => {
  expect(readCard("X", "Sorcery", "Each opponent who doesn't loses 3 life.").complete).toBe(false);
  const g = readCard("Y", "Sorcery", "Exile the top three cards of your library. Put one of them into your hand.");
  expect(g.records[0]!.actions![1]).toMatchObject({ verb: "put", fromZone: "exile" });
  const durnan = readCard("Durnan of the Yawning Portal", "Legendary Creature — Human Warrior", "Whenever Durnan of the Yawning Portal attacks, look at the top four cards of your library. You may exile a creature card from among them. Put the rest on the bottom of your library in any order.");
  expect(durnan.records[0]!.actions![1]).toMatchObject({ verb: "put", fromZone: "library", toZone: "library" });
});

test("Time and Tide: 'Simultaneously' is a timing word, the two phasing verbs are the actions (CR 702.26a, #1210 task 3)", () => {
  const g = readCard("Time and Tide", "Instant", "Simultaneously, all phased-out creatures phase in and all creatures with phasing phase out.");
  expect(g.complete).toBe(true);
  expect(g.records[0]!.actions!.map((a) => a.verb)).toEqual(["phase-in", "phase-out"]);
});

test("Pulse of Llanowar: the basic-land colour replacement is one `other` action, never add-mana (#1210 task 4)", () => {
  const g = readCard("Pulse of Llanowar", "Enchantment", "If a basic land you control is tapped for mana, it produces mana of a color of your choice instead of any other type.");
  expect(g.complete).toBe(true);
  expect(g.records[0]!.actions!.map((a) => a.verb)).toEqual(["other"]);
});

test("Crowd-Control Warden: after the 'As this creature enters or is turned face up' lead-in, 'it' is the card, so the counter emit is self", async () => {
  const { deriveInputOf } = await import("../derive-input.js");
  const { deriveCardTags } = await import("../derive/derive.js");
  const card = { name: "Crowd-Control Warden", typeLine: "Creature — Human Soldier", oracleText: "As this creature enters or is turned face up, put X +1/+1 counters on it, where X is the number of other creatures you control.", keywords: [] as string[] };
  const g = grammarClauseRecords(card);
  const tags = deriveCardTags(deriveInputOf(card as never, "x", card.name, g.records, undefined, g.readings));
  expect(tags.abilities[0]!.emits?.[0]).toMatchObject({ verb: "counter-added", subject: { counter: "+1/+1", self: true } });
});

test("Astrid Peth: a stored record split off a compound does not take the printed trigger of the clause segment() numbered the same", async () => {
  const { deriveInputOf } = await import("../derive-input.js");
  const { deriveCardTags } = await import("../derive/derive.js");
  const card = { name: "Astrid Peth", typeLine: "Legendary Creature — Human Peasant", keywords: [] as string[],
    oracleText: "Whenever Astrid Peth enters or attacks, create a Food token.\nBrand-new Sky — Whenever you sacrifice a Clue or Food, Astrid Peth explores." };
  const act = (verb: string, object: string) => [{ verb, object, fromZone: null, toZone: null, amount: verb === "create" ? "1" : null, optional: false }];
  const stored = [
    { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "Astrid Peth", control: "you" }, actions: act("create", "a Food token") },
    { id: 2, abilityType: "triggered", trigger: { event: "attacks", subject: "Astrid Peth", control: "you" }, actions: act("create", "a Food token") },
    { id: 3, abilityType: "triggered", trigger: { event: "sacrificed", subject: "a Clue or Food", control: "you" }, actions: act("explore", "Astrid Peth") },
  ];
  const tags = deriveCardTags(deriveInputOf(card as never, "x", card.name, stored as never));
  // The sacrifice trigger carries the explore, never the Food: no ability pairs it with a create-token emit.
  const sacrifice = tags.abilities.filter((a) => a.trigger?.verbs?.includes("sacrifice" as never));
  expect(sacrifice.length).toBeGreaterThan(0);
  expect(sacrifice.flatMap((a) => a.emits ?? []).map((e) => e.verb)).not.toContain("create-token");
  expect(tags.abilities.filter((a) => a.trigger?.verbs?.includes("attacks" as never)).flatMap((a) => a.emits ?? []).map((e) => e.verb)).toContain("create-token");
});

test("Kratos, Stoic Father: a record numbered into another sentence reads that sentence, never a mix; its twin of an already-read event is dropped", async () => {
  const { deriveInputOf } = await import("../derive-input.js");
  const { deriveCardTags } = await import("../derive/derive.js");
  const card = { name: "Kratos, Stoic Father", typeLine: "Legendary Creature — God Warrior", keywords: ["Partner"] as string[],
    oracleText: "Whenever you attack with one or more Gods and whenever a God dies, you get an experience counter.\nAt the beginning of your end step, put a number of +1/+1 counters on target creature equal to the number of experience counters you have.\nPartner\u2014Father & son" };
  const stored = [
    { id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "one or more Gods", control: "you" }, actions: [{ verb: "add-counter", object: "experience counter", optional: false }] },
    { id: 2, abilityType: "triggered", trigger: { event: "dies", subject: "a God", control: "you" }, actions: [{ verb: "add-counter", object: "experience counter", optional: false }] },
    { id: 3, abilityType: "triggered", trigger: { event: "end-step", control: "you" }, actions: [{ verb: "add-counter", object: "+1/+1 counter", amount: "the number of experience counters you have", optional: false }] },
    { id: 3, abilityType: "none", actions: [{ verb: "none", object: "Partner\u2014Father & son" }] },
  ];
  const tags = deriveCardTags(deriveInputOf(card as never, "x", card.name, stored as never));
  const view = tags.abilities.map((a) => [a.trigger?.verbs?.[0], (a.emits ?? []).map((e) => e.subject.counter).join(",")]);
  expect(view).toEqual([["attacks", "experience"], ["dies", "experience"], ["end-step", "+1/+1"]]);
});

test("a reflexive 'When you do' record is never re-homed (Curious Forager); a re-homed twin that carries more than its partner is kept (Champions of the Shoal)", async () => {
  const { deriveInputOf } = await import("../derive-input.js");
  const { deriveCardTags } = await import("../derive/derive.js");
  const act = (verb: string, object: string, extra: Record<string, unknown> = {}) => ({ verb, object, fromZone: null, toZone: null, amount: null, optional: false, ...extra });
  const forager = { name: "Curious Forager", typeLine: "Creature — Squirrel Druid", keywords: [] as string[],
    oracleText: "When this creature enters, you may forage. When you do, return target permanent card from your graveyard to your hand. (To forage, exile three cards from your graveyard or sacrifice a Food.)" };
  const fStored = [
    { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" }, actions: [act("forage", "", { optional: true })] },
    { id: 2, abilityType: "triggered", trigger: { event: "forage", subject: "you", control: "you" }, actions: [act("return", "target permanent card", { fromZone: "graveyard", toZone: "hand" })] },
  ];
  const f = deriveCardTags(deriveInputOf(forager as never, "x", forager.name, fStored as never));
  const back = f.abilities.find((a) => a.effect.kind === "graveyard-recursion");
  expect(back?.trigger?.verbs).toEqual(["forage"]);
  expect(back?.emits?.find((e) => e.verb === "leaves")?.subject).toMatchObject({ control: "you", fromZone: "graveyard" });
  const champs = { name: "Champions of the Shoal", typeLine: "Creature — Merfolk Wizard", keywords: [] as string[],
    oracleText: "As an additional cost to cast this spell, behold a Merfolk and exile it. (Exile a Merfolk you control or a Merfolk card from your hand.)\nWhenever this creature enters or becomes tapped, tap up to one target creature and put a stun counter on it.\nWhen this creature leaves the battlefield, return the exiled card to its owner's hand." };
  // The twin (3, `taps`) carries a stun counter its partner (2) does not: it is kept, not dropped as a duplicate.
  const cStored = [
    { id: 1, abilityType: "static", actions: [act("behold", "a Merfolk"), act("exile", "it")] },
    { id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" }, actions: [act("tap", "up to one target creature", { optional: true })] },
    { id: 3, abilityType: "triggered", trigger: { event: "taps", subject: "this creature", control: "you" }, actions: [act("tap", "up to one target creature", { optional: true }), act("add-counter", "stun counter")] },
    { id: 4, abilityType: "triggered", trigger: { event: "leaves", subject: "this creature", control: "you" }, actions: [act("return", "the exiled card", { fromZone: "exile", toZone: "hand" })] },
  ];
  const c = deriveCardTags(deriveInputOf(champs as never, "x", champs.name, cStored as never));
  expect(c.abilities.some((a) => a.trigger?.verbs?.[0] === "taps" && (a.emits ?? []).some((e) => e.subject.counter === "stun"))).toBe(true);
});

test("Kratos, Stoic Father as shipped (grammar path): attacks, dies, end-step, and the two-event overflow's twin dies", async () => {
  const { deriveInputOf } = await import("../derive-input.js");
  const { deriveCardTags } = await import("../derive/derive.js");
  const card = { name: "Kratos, Stoic Father", typeLine: "Legendary Creature — God Warrior", keywords: ["Partner"] as string[],
    oracleText: "Whenever you attack with one or more Gods and whenever a God dies, you get an experience counter.\nAt the beginning of your end step, put a number of +1/+1 counters on target creature equal to the number of experience counters you have.\nPartner\u2014Father & son" };
  const g = grammarClauseRecords(card);
  const tags = deriveCardTags(deriveInputOf(card as never, "x", card.name, g.records, undefined, g.readings));
  // CEILING: the second event of a two-event trigger is an overflow record numbered after the last clause (the store's convention), so the
  // `dies` the first record already reads off the sentence is read a second time (c4). A twin, harmless to edges; not deduplicated here.
  expect(tags.abilities.map((a) => [a.clause, a.trigger?.verbs?.[0]])).toEqual([[1, "attacks"], [1, "dies"], [2, "end-step"], [4, "dies"]]);
  expect(tags.abilities.find((a) => a.trigger?.verbs?.[0] === "end-step")?.emits?.[0]?.subject).toMatchObject({ counter: "+1/+1" });
});

test("a reflexive sentence is never re-homed: Yes Man keeps the quest counter on itself, Explosion of Riches keeps its refusal (#1210)", async () => {
  const { deriveInputOf } = await import("../derive-input.js");
  const { deriveCardTags } = await import("../derive/derive.js");
  const act = (verb: string, object: string, extra: Record<string, unknown> = {}) => ({ verb, object, fromZone: null, toZone: null, amount: null, optional: false, ...extra });
  const yes = { name: "Yes Man, Personal Securitron", typeLine: "Legendary Artifact Creature — Robot", keywords: [] as string[],
    oracleText: "{T}: Target opponent gains control of Yes Man. When they do, you draw two cards and put a quest counter on Yes Man. Activate only during your turn.\nWild Card \u2014 When Yes Man leaves the battlefield, its owner creates a tapped 1/1 white Soldier creature token for each quest counter on it." };
  const yStored = [
    { id: 1, abilityType: "activated", actions: [act("gain-control", "target opponent")] },
    { id: 2, abilityType: "triggered", trigger: { event: "gains-control", subject: "Yes Man", control: "opponent" }, actions: [act("draw", "you", { amount: "2" }), act("add-counter", "quest counter")] },
    { id: 3, abilityType: "triggered", trigger: { event: "leaves", subject: "Yes Man", control: "you" }, actions: [act("create", "a tapped 1/1 white Soldier creature token", { amount: "number of quest counters on Yes Man" })] },
  ];
  const y = deriveCardTags(deriveInputOf(yes as never, "x", yes.name, yStored as never));
  expect(y.abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "counter-added" && e.subject.counter === "quest")?.subject.self).toBe(true);
  const ex = { name: "Explosion of Riches", typeLine: "Sorcery", keywords: [] as string[],
    oracleText: "Draw a card, then each other player may draw a card. Whenever a card is drawn this way, Explosion of Riches deals 5 damage to target opponent chosen at random from among your opponents." };
  const eStored = [
    { id: 1, abilityType: "spell", actions: [act("draw", "a card"), act("draw", "a card", { optional: true })] },
    { id: 2, abilityType: "triggered", trigger: { event: "draw", subject: "a card", control: "any" }, actions: [act("deal-damage", "target opponent chosen at random from among your opponents", { amount: "5" })] },
  ];
  const e = deriveCardTags(deriveInputOf(ex as never, "x", ex.name, eStored as never));
  expect(e.abilities.filter((a) => a.trigger?.verbs?.includes("draw" as never)).length).toBe(0);
});

test("Territory Culler: the looked-at card goes from YOUR library to your graveyard, so the mill emit is control you; Domri's dig still names creature", async () => {
  const { deriveInputOf } = await import("../derive-input.js");
  const { deriveCardTags } = await import("../derive/derive.js");
  const derive = (name: string, typeLine: string, oracleText: string) => {
    const card = { name, typeLine, oracleText, keywords: [] as string[] };
    const g = grammarClauseRecords(card);
    return deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings));
  };
  const culler = derive("Territory Culler", "Creature — Eldrazi Drone", "Landfall \u2014 Whenever a land you control enters, look at the top card of your library. If it's a creature card, you may reveal it and put it into your hand. If you don't put the card into your hand, you may put it into your graveyard.");
  const mill = culler.abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "mill");
  expect(mill?.subject).toMatchObject({ control: "you", fromZone: "library" });
  expect(mill?.subject.type).toBeUndefined();
  // "Otherwise" / "if you don't": the card the condition did not take is untyped and never the card itself (Bison Whistle, Traveling Botanist).
  const whistle = derive("Bison Whistle", "Artifact", "{1}, {T}: Look at the top card of your library. If it's a Bison card, you may put it onto the battlefield. If it's a creature card, you may reveal it and put it into your hand. Otherwise, you may put it into your graveyard.");
  const wMill = whistle.abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "mill");
  expect(wMill?.subject).toMatchObject({ control: "you", fromZone: "library" });
  expect(wMill?.subject.type).toBeUndefined();
  const botanist = derive("Traveling Botanist", "Creature — Elf Scout", "Whenever this creature becomes tapped, look at the top card of your library. If it's a land card, you may reveal it and put it into your hand. If you don't put the card into your hand, you may put it into your graveyard.");
  const bMill = botanist.abilities.find((a) => (a.emits ?? []).some((e) => e.verb === "mill"));
  expect(bMill?.emits?.find((e) => e.verb === "mill")?.subject).toMatchObject({ control: "you", fromZone: "library" });
  expect(bMill?.emits?.find((e) => e.verb === "mill")?.subject.type).toBeUndefined();
  expect(bMill?.emits?.find((e) => e.verb === "mill")?.subject.self).toBeUndefined();
  expect(bMill?.effect.subject?.self).toBeUndefined();
  const domri = derive("Domri Rade", "Legendary Planeswalker — Domri", "+1: Look at the top card of your library. If it's a creature card, you may reveal it and put it into your hand.");
  expect(domri.abilities.find((a) => a.effect.kind === "search")?.effect.subject).toMatchObject({ type: "creature" });
});

test("a 'look at the top card' whose later 'it' / 'that card' is resolved to the library reads complete; one nothing touches still blocks (#1210)", () => {
  const domri = readCard("Domri Rade", "Legendary Planeswalker — Domri", "+1: Look at the top card of your library. If it's a creature card, you may reveal it and put it into your hand.");
  expect(domri.complete).toBe(true);
  expect(domri.records[0]!.actions!.find((a) => a.verb === "put")).toMatchObject({ object: "a creature card from the top card of your library", fromZone: "library", toZone: "hand" });
  const merrow = readCard("Puresight Merrow", "Creature — Merfolk Wizard", "{W/U}, {Q}: Look at the top card of your library. You may exile that card.");
  expect(merrow.complete).toBe(true);
  expect(merrow.records[0]!.actions!.find((a) => a.verb === "exile")).toMatchObject({ fromZone: "library" });
  const hound = readCard("Codecracker Hound", "Creature — Dog", "When this creature enters, look at the top two cards of your library. Put one into your hand and the other into your graveyard.");
  expect(hound.complete).toBe(true);
  expect(hound.records[0]!.actions!.filter((a) => a.verb === "put").map((a) => [a.fromZone, a.toZone])).toEqual([["library", "hand"], ["library", "graveyard"]]);
  const reef = readCard("Risen Reef", "Creature — Elemental", "Whenever Risen Reef or another Elemental you control enters, look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped. If you don't put the card onto the battlefield, put it into your hand.");
  expect(reef.complete).toBe(true);
  expect(reef.records[0]!.actions!.filter((a) => a.verb === "put").map((a) => [a.object, a.fromZone, a.toZone])).toEqual([["a land card from the top card of your library", "library", "battlefield"], ["the top card of your library", "library", "hand"]]);
  // The card EXILED from the look is in exile, not the library (Discover the Impossible; stored answer: exile).
  const disc = readCard("Discover the Impossible", "Sorcery", "Look at the top five cards of your library. Exile one of them face down and put the rest on the bottom of your library in a random order. You may cast the exiled card without paying its mana cost if it's an instant spell with mana value 2 or less. If you don't, put that card into your hand.");
  expect(disc.records[0]!.actions!.filter((a) => a.verb === "put").map((a) => [a.object, a.fromZone, a.toZone])).toEqual([["the rest of the top five cards of your library", "library", "library"], ["that card", "exile", "hand"]]);
  // A condition that names no card type does not become one ("a your turn card").
  const turn = readCard("Peek Two", "Instant", "Look at the top card of your library. If it's your turn, put it into your hand.");
  expect(turn.records[0]!.actions!.find((a) => a.verb === "put")).toMatchObject({ object: "it", fromZone: "library" });
  // A spell that returns itself as it resolves leaves the stack (Petals of Insight; stored answer: stack).
  const petals = readCard("Petals of Insight", "Sorcery — Arcane", "Look at the top three cards of your library. You may put those cards on the bottom of your library in any order. If you do, return Petals of Insight to its owner's hand. Otherwise, draw three cards.");
  expect(petals.records[0]!.actions!.find((a) => a.verb === "return")).toMatchObject({ fromZone: "stack", toZone: "hand" });
  // A look no later action touches is an unread phrase: the card blocks.
  expect(readCard("Peek", "Instant", "Look at the top card of your library. Then draw a card.").complete).toBe(false);
  // A look whose "of them" / "the rest" picks the library up is still skipped, and the rest is milled by you.
  const sp = readCard("Strategic Planning", "Sorcery", "Look at the top three cards of your library. Put one of them into your hand and the rest into your graveyard.");
  expect(sp.complete).toBe(true);
  expect(sp.records[0]!.actions!.map((a) => a.verb)).toEqual(["put", "put"]);
  expect(sp.records[0]!.actions![0]).toMatchObject({ fromZone: "library" });
});

test("a cause is no part of the trigger subject: the caused object is (#1253, Sacred Ground)", () => {
  expect(triggerSubjectText("Whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield")).toBe("a land you control");
  expect(triggerSubjectText("When a spell or ability an opponent controls causes you to discard this card")).toBe("this card");
});

test("Sacred Ground's return is of YOUR land: control you, not the opponent whose spell caused it", () => {
  const text = "Whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield, return that card to the battlefield.";
  const g = grammarClauseRecords({ name: "Sacred Ground", oracleText: text, typeLine: "Enchantment", manaCost: "{1}{W}", keywords: [] } as never);
  expect(g.records[0]!.trigger!.subject).toBe("a land you control");
});

test("only 'a spell or ability ... causes' is rewritten: another cause keeps the old subject text (#1253)", () => {
  // Unanchored, `^.+? causes? (.+?) to` rewrote 23 corpus preambles (Firesong and Sunspeaker, Toofer, Strict Proctor ...).
  expect(triggerSubjectText("Whenever a player causes a creature to be sacrificed")).toBe("a player causes a creature to be sacrificed");
  expect(triggerSubjectText("Whenever a source an opponent controls causes you to gain life")).toBe("a source an opponent controls causes you to");
});

// #1252: the whole chain -- grammar reading -> clause record (NO_OBJECT_YOU) -> derive. Phage's printed text, verbatim from the corpus.
test("Phage the Untouchable: its own loss is yours, the player it damages is an opponent's", () => {
  const phage = {
    name: "Phage the Untouchable", typeLine: "Legendary Creature — Phage", keywords: ["Deathtouch"], colors: ["B"], colorIdentity: ["B"], manaValue: 7, power: "4", toughness: "4",
    oracleText: "When Phage enters, if you didn't cast it from your hand, you lose the game.\nWhenever Phage deals combat damage to a creature, destroy that creature. It can't be regenerated.\nWhenever Phage deals combat damage to a player, that player loses the game.",
  };
  const g = grammarClauseRecords(phage);
  expect(g.complete).toBe(true);
  const tags = deriveCardTags(deriveInputOf(phage as never, "phage", phage.name, g.records, undefined, g.readings));
  const lg = tags.abilities.flatMap((a) => (a.emits ?? []).filter((e) => e.verb === "loses-game").map((e) => [a.clause, e.subject.control] as const));
  expect(lg).toEqual([[1, "you"], [3, "opp"]]);
});

// #1349 task 1: the parent of a triggered or activated modal ability is its intro ("choose one —"), no action of its own.
test("a modal parent reads as the store records it: the trigger, no action, and the modes as their own clauses", () => {
  const odo = grammarClauseRecords({ name: "Constable Odo", typeLine: "Legendary Creature — Shapeshifter Detective", keywords: ["Investigate"], oracleText: "When Constable Odo enters, choose one —\n• Tap target creature an opponent controls. Put two stun counters on it. (If a permanent with a stun counter would become untapped, remove one from it instead.)\n• Investigate twice. (To investigate, create a Clue token. It's an artifact with \"{2}, Sacrifice this token: Draw a card.\")" });
  expect(odo.blocker).toBeUndefined();
  expect(odo.complete).toBe(true);
  expect(odo.records[0]).toMatchObject({ id: 1, abilityType: "triggered", trigger: { event: "enters", control: "you" }, actions: [{ verb: "none", object: "" }] });
  expect(odo.records.map((r) => r.id)).toEqual([1, 2, 3]);
  // A mode is typed triggered and carries no trigger of its own.
  expect(odo.records[1]).toMatchObject({ id: 2, abilityType: "triggered" });
  expect(odo.records[1]!.trigger).toBeUndefined();
  const kirk = grammarClauseRecords({ name: "Captain James T. Kirk", typeLine: "Legendary Creature — Human Officer", oracleText: "Whenever Captain Kirk enters or attacks, choose one. If you have no cards in hand, choose one or more instead.\n• Discard a card, then draw a card.\n• Create a 1/1 red Officer creature token.\n• Creatures you control get +1/+0 until end of turn." });
  expect(kirk.complete).toBe(true);
  expect(kirk.records[0]).toMatchObject({ id: 1, trigger: { event: "enters" }, actions: [{ verb: "none" }] });
  const tea = grammarClauseRecords({ name: "Tea, Earl Grey, Hot", typeLine: "Artifact — Food", oracleText: "When this artifact enters, draw a card.\n{2}, {T}, Sacrifice this artifact: Choose one —\n• This artifact deals 2 damage to target opponent.\n• You gain 3 life." });
  expect(tea.complete).toBe(true);
  expect(tea.records.map((r) => r.abilityType)).toEqual(["triggered", "activated", "activated", "activated"]);
  const vger = grammarClauseRecords({ name: "V'Ger, the Intruder", typeLine: "Legendary Artifact Creature — Construct", keywords: ["Flying"], oracleText: "Flying\nWhenever V'Ger enters or attacks, choose one —\n• Look at target opponent's hand, then draw a card.\n• Creatures your opponents control get -1/-0 until your next turn." });
  // V'Ger's intro reads; the card still waits on its second mode's "look at target opponent's hand".
  expect(vger.blocker).toMatchObject({ clause: 3, kind: "action", phrase: "look at target opponent's hand" });
  expect(vger.records[1]).toMatchObject({ id: 2, trigger: { event: "enters" }, actions: [{ verb: "none" }] });
});

test("a choice that is not a modal intro is still unread", () => {
  for (const text of ["When this land enters, choose a color.", "When this creature enters, choose a creature type.", "When this creature enters, choose one of them at random."]) {
    const g = grammarClauseRecords({ name: "X", typeLine: "Creature — Elf", oracleText: text });
    expect(g.complete, text).toBe(false);
    expect(g.blocker, text).toMatchObject({ clause: 1, kind: "action" });
  }
});

// #1349 review: a mode whose header's trigger was refused does not re-derive the raw trigger against its own bullet.
test("a mode under a refused header trigger carries no trigger, and the refusal is recorded", async () => {
  const { deriveInputOf } = await import("../derive-input.js");
  const { deriveCardTags } = await import("../derive/derive.js");
  const cards = [
    { name: "Jin Sakai, Ghost of Tsushima", typeLine: "Legendary Creature — Human Samurai", keywords: ["Ghost", "Standoff"], oracleText: "Whenever Jin Sakai deals combat damage to a player, draw a card.\nWhenever a creature you control attacks a player, if no other creatures are attacking that player, choose one —\n• Standoff — It gains double strike until end of turn.\n• Ghost — It can't be blocked this turn." },
    { name: "Wardens of the Cycle", typeLine: "Creature — Elf Warlock", keywords: ["Morbid"], oracleText: "Morbid — At the beginning of your end step, if a creature died this turn, choose one —\n• You gain 2 life.\n• You draw a card and you lose 1 life." },
  ];
  for (const card of cards) {
    const g = grammarClauseRecords(card);
    expect(g.complete, card.name).toBe(true);
    const tags = deriveCardTags(deriveInputOf(card as never, "x", card.name, g.records, undefined, g.readings));
    const header = card.name.startsWith("Jin") ? 2 : 1;
    const modes = tags.abilities.filter((a) => a.clause !== undefined && a.clause > header);
    expect(modes.length, card.name).toBeGreaterThan(0);
    for (const m of modes) expect(m.trigger, `${card.name} clause ${m.clause}`).toBeUndefined();
    if (card.name.startsWith("Jin")) expect((tags.unknownTriggers ?? []).filter((r) => r.startsWith("if:")).length).toBeGreaterThanOrEqual(3);
  }
});

test("a card leaving exile is from exile; a destination 'bottom of its owner's library' is not a source (#1349 review)", () => {
  const from = (text: string, type = "Creature — Elf") => {
    const g = grammarClauseRecords({ name: "X", typeLine: type, oracleText: text });
    expect(g.complete, text).toBe(true);
    return g.records.flatMap((r) => r.actions ?? []).find((a) => a.verb === "put" || a.verb === "return" || a.verb === "search")?.fromZone;
  };
  expect(from("When this creature enters, put target exiled card with warp on the bottom of its owner's library.")).toBe("exile");
  expect(from("When this creature enters, put target card you don't own in exile that has an Adventure on the bottom of its owner's library.")).toBe("exile");
  expect(from("When this creature enters, return target card you own in exile that has an Adventure to your hand.")).toBe("exile");
  expect(from("When this creature enters, put target creature on the bottom of its owner's library.")).toBe("battlefield");
  expect(from("When this creature enters, put a card from the top of your library into your hand.")).toBe("library");
});

test("a put back on top of your library is a library to library put; the bottom of it is not (#1349 review)", async () => {
  const { deriveInputOf } = await import("../derive-input.js");
  const { deriveCardTags } = await import("../derive/derive.js");
  const triumph = { name: "Triumph of Saint Katherine", typeLine: "Creature — Angel", keywords: [] as string[], oracleText: "When this creature is put into your graveyard from the battlefield, exile it and the top six cards of your library in a face-down pile. If you do, shuffle that pile and put it back on top of your library." };
  const g = grammarClauseRecords(triumph);
  expect(g.complete).toBe(true);
  expect(g.records.flatMap((r) => r.actions ?? []).find((a) => a.verb === "put")).toMatchObject({ fromZone: "library", toZone: "library" });
  const tags = deriveCardTags(deriveInputOf(triumph as never, "x", triumph.name, g.records, undefined, g.readings));
  expect(tags.abilities.some((a) => a.effect.kind === "top-set")).toBe(true);
  const codie = grammarClauseRecords({ name: "X", typeLine: "Artifact", oracleText: "{4}, {T}: Exile cards from the top of your library until you exile an instant or sorcery card. Put each other card exiled this way on the bottom of your library in a random order." });
  expect(codie.records.flatMap((r) => r.actions ?? []).find((a) => a.verb === "put")?.fromZone).toBeNull();
  const doom = grammarClauseRecords({ name: "X", typeLine: "Sorcery", oracleText: "Search your library and graveyard for five cards and exile the rest. Put the chosen cards on top of your library in any order." });
  expect(doom.records.flatMap((r) => r.actions ?? []).find((a) => a.verb === "put")).toMatchObject({ fromZone: "library" });
});

test("a pronoun put on top of a library keeps the zone its earlier move left (#1349 review)", () => {
  const put = (text: string) => {
    const g = grammarClauseRecords({ name: "X", typeLine: "Sorcery", oracleText: text });
    expect(g.complete, text).toBe(true);
    return g.records.flatMap((r) => r.actions ?? []).find((a) => a.verb === "put")?.fromZone;
  };
  expect(put("Exile target creature. Put it on top of its owner's library.")).toBe("exile");
  expect(put("Destroy target creature. Put it on top of its owner's library.")).toBeNull();
});

test("the modal intros: 'that hasn't been chosen', 'worth of modes', 'one or both' read as the parent's action (#1349 review)", () => {
  const kobayashi = grammarClauseRecords({ name: "Kobayashi Maru Scenario", typeLine: "Enchantment", oracleText: "At the beginning of your upkeep, choose one that hasn't been chosen —\n• Hail — Return up to one target creature an opponent controls with mana value 3 or less to its owner's hand.\n• Sensors — Draw two cards.\n• Transport — Create two 1/1 red Officer creature tokens.\n• Abandon Ship — You lose the game." });
  expect(kobayashi.blocker).toBeUndefined();
  expect(kobayashi.records[0]).toMatchObject({ id: 1, abilityType: "triggered", trigger: { event: "upkeep" }, actions: [{ verb: "none" }] });
  expect(kobayashi.records.length).toBe(5);
  const hela = grammarClauseRecords({ name: "Hela's Arcanum", typeLine: "Instant — Arcane", oracleText: "Choose up to five {P} worth of modes. You may choose the same mode more than once.\n{P} — Target creature gets +1/+0 and gains deathtouch until end of turn.\n{P}{P} — Until end of turn, target creature gains \"When this creature dies, return it to the battlefield tapped under its owner's control.\"\n{P}{P}{P} — Destroy each non-Zombie creature with power 3 or less." });
  expect(hela.blocker).toBeUndefined();
  expect(hela.complete).toBe(true);
  const flash = grammarClauseRecords({ name: "Flash Thompson, Spider-Fan", typeLine: "Legendary Creature — Human Citizen", keywords: ["Hero Worship", "Heckle", "Flash"], oracleText: "Flash\nWhen Flash Thompson enters, choose one or both —\n• Heckle — Tap target creature.\n• Hero Worship — Untap target creature." });
  expect(flash.blocker).toBeUndefined();
  expect(flash.records[1]).toMatchObject({ abilityType: "triggered", trigger: { event: "enters" }, actions: [{ verb: "none" }] });
});

// #1349 task 2: a card's short names and pronouns are the card itself, never a class.
const selfCard = (name: string, oracleText: string, typeLine = "Legendary Creature — Human") => grammarClauseRecords({ name, typeLine, oracleText });

test("a short name is the card: title + surname, a possessive, a cost, the literal CARDNAME", () => {
  expect(selfAsTilde("When Captain Archer enters, draw a card.", "Captain Jonathan Archer")).toBe("When ~ enters, draw a card.");
  expect(selfAsTilde("Put a counter on Dr. Crusher.", "Dr. Beverly Crusher")).toBe("Put a counter on ~.");
  expect(selfAsTilde("where X is Picard's power", "Picard, Leading by Example")).toBe("where X is ~'s power");
  expect(selfAsTilde("Seven of Nine's base power", "Seven of Nine, Unassimilated")).toBe("~'s base power");
  expect(selfAsTilde("put a quest counter on CARDNAME", "Coastal Ren Faire")).toBe("put a quest counter on ~");
  // A name only as a whole word, and only a possessive 's: "Pickards" and "Picard'" are not the card.
  expect(selfAsTilde("Picards and Picard'", "Picard, Leading by Example")).toBe("Picards and Picard'");
});

test("a comma name whose short form is a common word does not turn that word into the card", () => {
  const storm = selfAsTilde("Whenever Storm deals combat damage to a player, the next instant or sorcery spell you cast this turn has storm.", "Storm, Force of Nature");
  expect(storm).toBe("Whenever ~ deals combat damage to a player, the next instant or sorcery spell you cast this turn has storm.");
  // CASE-SENSITIVE, and a title only shortens a title name: no "Captain Dragon" from a plain two-word name.
  expect(selfAsTilde("Dragon Whelp", "Dragon Whelp")).toBe("~");
  expect(selfAsTilde("Captain of the Watch", "Captain Jonathan Archer")).toBe("Captain of the Watch");
});

test("a pronoun is the card only after a self trigger and with no earlier antecedent", () => {
  expect(selfPronouns("put a promotion counter on her. Then if there are three or more promotion counters on her, remove those counters and she deals 2 damage to each opponent.")).toBe("put a promotion counter on ~. Then if there are three or more promotion counters on ~, remove those counters and ~ deals 2 damage to each opponent.");
  // A target before the pronoun is its antecedent; a possessive stays.
  expect(selfPronouns("destroy target creature. Its controller loses life equal to her power.")).toBe("destroy target creature. Its controller loses life equal to her power.");
  expect(selfPronouns("return target creature card to your hand and put a counter on her")).toBe("return target creature card to your hand and put a counter on her");
  expect(selfPronouns("you gain life equal to her power")).toBe("you gain life equal to her power");
  // Not from a trigger on something else: effectText only applies it after "When/Whenever <the name>".
  expect(effectText("Whenever a creature dies, put a counter on her.", "Beta Ray Bill")).toBe("put a counter on her.");
  expect(effectText("Whenever Beta Ray Bill attacks, put a counter on him.", "Beta Ray Bill")).toBe("put a counter on ~.");
});

test("the self-name cards move past their self-reference and stop at the NEXT phrase", () => {
  const reads = (name: string, text: string, typeLine?: string) => selfCard(name, text, typeLine);
  expect(reads("Captain Jonathan Archer", "When Captain Archer enters, create Porthos, a legendary 1/1 green Dog creature token.").complete).toBe(true);
  expect(reads("Captain Michael Burnham", "Whenever a land you control enters, Captain Burnham deals 1 damage to each opponent. If this is the second time this ability has resolved this turn, put a +1/+1 counter on Captain Burnham.").complete).toBe(true);
  expect(reads("Dr. Beverly Crusher", "Whenever you gain life, put a +1/+1 counter on Dr. Crusher.").complete).toBe(true);
  expect(reads("Beta Ray Bill", "Valiant — Whenever Beta Ray Bill becomes the target of a spell or ability you control for the first time each turn, put a +1/+1 counter on him and up to one target God you control.").complete).toBe(true);
  expect(reads("Kirk, Commanding Officer", "{2}, Sacrifice Kirk: Destroy target artifact or enchantment.").complete).toBe(true);
  expect(reads("Coastal Ren Faire", "Whenever you cast a noncreature spell, put a quest counter on CARDNAME. Draw a card. Then discard a card unless there are three or more quest counters on CARDNAME.", "Enchantment").complete).toBe(true);
  expect(reads("The Darkhold", "{T}: Put a sin counter on The Darkhold. Draw a card for each sin counter on it, then you lose 1 life for each card in your hand.", "Legendary Artifact").complete).toBe(true);
  // ...and the next blocker, task 4's.
  expect(reads("Picard, Leading by Example", "{1}, {T}: Another target creature gets +X/+X until end of turn, where X is Picard's power. Activate only as a sorcery.").blocker?.phrase).toBe("activate only as a sorcery");
  expect(reads("Seven of Nine, Unassimilated", "{6}{U}: Seven of Nine's base power and toughness become 7/9. Activate only if you control seven or more differently named lands.").blocker?.phrase).toBe("activate only if you control seven or more differently named lands");
  expect(reads("Ensign Pavel Chekov", "Strange new worlds — When Ensign Chekov enters, each opponent exiles the top X cards of their library, where X is the number of differently named lands you control. For each opponent, choose a land card that player owns exiled this way. You may play the chosen cards for as long as they remain exiled.").blocker?.phrase).toBe("for each opponent");
  expect(reads("Beckett Mariner, Impetuous Ensign", "Reckless Behavior — Whenever Beckett Mariner becomes tapped, put a promotion counter on her. Then if there are three or more promotion counters on her, remove those counters and she deals 2 damage to each opponent.").blocker?.phrase).toBe("then if there are three or more promotion counters on ~, remove those counters");
});

// #1349 task 2 follow-up: regressions the identity proof found in the self-name work.
const derivedFrom = (name: string, typeLine: string, oracleText: string) => {
  const card = { name, typeLine, oracleText, keywords: [] as string[] };
  const g = grammarClauseRecords(card);
  return deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings));
};

test("the card's possessive in a filter or trigger is read, not refused", () => {
  const alesha = derivedFrom("Alesha, Who Laughs at Fate", "Legendary Creature — Human Warrior", "Raid — At the beginning of your end step, if you attacked this turn, return target creature card with mana value less than or equal to Alesha's power from your graveyard to the battlefield.");
  expect(alesha.abilities[0]!.effect.subject).toMatchObject({ fromZone: "graveyard", stats: [{ metric: "mana-value", op: "lte", variable: true }] });
  const jackal = derivedFrom("Jackal, Genius Geneticist", "Legendary Creature — Human Mutant Scientist", "Whenever you cast a creature spell with mana value equal to Jackal's power, copy that spell, except the copy isn't legendary. Then put a +1/+1 counter on Jackal.");
  expect(jackal.abilities[0]!.trigger).toMatchObject({ verbs: ["cast"], subject: { type: "creature", stats: [{ metric: "mana-value", op: "eq", variable: true }] } });
});

test("a possessive naming ANOTHER object ('Volo's Journal') is not the card", () => {
  expect(selfAsTilde("create Volo's Journal, a token. Draw a card for each noted for target permanent named Volo's Journal.", "Volo, Itinerant Scholar"))
    .toBe("create Volo's Journal, a token. Draw a card for each noted for target permanent named Volo's Journal.");
  expect(selfAsTilde("token named Ajani's Pridemate. exile Ajani and each creature", "Ajani, Strength of the Pride")).toBe("token named Ajani's Pridemate. exile ~ and each creature");
  expect(selfAsTilde("create Koma's Coil", "Koma, World-Eater")).toBe("create Koma's Coil");
  expect(selfAsTilde("equal to Gandalf's owner", "Gandalf, Wandering Wizard")).toBe("equal to ~'s owner");
});

test("a counter on a compound target keeps its subject (Omo), the two-recipient shape is the card and one more", () => {
  const omo = derivedFrom("Omo, Queen of Vesuva", "Legendary Creature — Elemental Shapeshifter", "Whenever Omo enters or attacks, put an everything counter on each of up to one target land and up to one target creature.");
  expect(omo.abilities[0]).toMatchObject({ effect: { subject: { type: ["creature", "land"], scope: "target" } }, amount: "1" });
});

test("Ulasht: one 'enters with' sentence holding two counter clauses is refused, not read as one amount", () => {
  const g = selfCard("Ulasht, the Hate Seed", "Ulasht enters with a +1/+1 counter on it for each other red creature you control and a +1/+1 counter on it for each other green creature you control.");
  expect(g.complete).toBe(false);
});

// #1349 task 2 review fixes.
test("the two-recipient counter shape: Beta Ray Bill's two actions; a 'for each' on the second recipient refuses", async () => {
  const { parseActions } = await import("./action.js");
  const bill = parseActions("put a +1/+1 counter on ~ and up to one target God you control", "triggered");
  expect(bill).toHaveLength(2);
  expect(bill.map((a) => a.verb)).toEqual(["add-counter", "add-counter"]);
  expect(bill.map((a) => a.counter)).toEqual(["+1/+1", "+1/+1"]);
  expect(bill[0]!.object).toMatchObject({ self: true });
  expect(bill[1]!.object).toMatchObject({ scope: "target" });
  expect(parseActions("put a +1/+1 counter on it and up to one target creature you control for each creature you control", "triggered")).toEqual([]);
});

test("a swallowed second counter clause blocks whether the recipient reads 'it' or '~'", () => {
  const g = selfCard("Ulasht, the Hate Seed", "Ulasht enters with a +1/+1 counter on ~ for each other red creature you control and a +1/+1 counter on ~ for each other green creature you control.");
  expect(g.complete).toBe(false);
});

test("Vhal: the card's own toughness in '~'s toughness still sets the mana floor, and the cant rider is kept", () => {
  const card = { name: "Vhal, Candlekeep Researcher", typeLine: "Legendary Creature — Human Cleric", power: "0", toughness: "3", keywords: ["Vigilance"] as string[],
    oracleText: "Vigilance\n{T}: Add an amount of {C} equal to Vhal's toughness. This mana can't be spent to cast spells from your hand." };
  const g = grammarClauseRecords(card);
  expect(g.complete).toBe(true);
  const tags = deriveCardTags(deriveInputOf(card as never, "x", card.name, g.records, undefined, g.readings));
  expect(tags.abilities.find((a) => a.effect.kind === "mana-generation")?.count).toMatchObject({ floor: 3 });
});
